// Match static application blur to the rendered client silhouette, including
// client-side decorations, shadows, antialiasing, and Wayland subsurfaces.
// This module changes no settings and never replaces the client's texture/mask.
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';

const BLUR_NAMES = new Set([
    'bms-application-blurred-widget', 'bms-backgroundgroup',
]);

const DECLARATIONS = `
uniform vec2 bms_mask_origin;
uniform vec2 bms_mask_dx;
uniform vec2 bms_mask_dy;
uniform float bms_mask_normalizer;
`;

const FRAGMENT = `
vec2 bms_uv = bms_mask_origin
    + cogl_tex_coord0_in.x * bms_mask_dx
    + cogl_tex_coord0_in.y * bms_mask_dy;
float bms_a = 0.0;
float bms_p = 0.0;
if (all(greaterThanEqual(bms_uv, vec2(0.0))) &&
    all(lessThanEqual(bms_uv, vec2(1.0)))) {
    bms_a = clamp(texture2D(cogl_sampler1, bms_uv).a * bms_mask_normalizer,
                  0.0, 1.0);
    bms_p = clamp(texture2D(cogl_sampler2, bms_uv).a * bms_mask_normalizer,
                  0.0, 1.0);
}
// A is the native silhouette; P is the rendered foreground at its intended
// opacity. Native shadows and overlapping subsurfaces need not obey P=O*A.
// Preserve coverage after compositing: P + M*(1-P) = A.
float bms_m = clamp((bms_a - bms_p) / max(0.00001, 1.0 - bms_p), 0.0, 1.0);
cogl_color_out *= bms_m;
`;

function point(x, y) {
    return new Graphene.Point3D({x, y, z: 0});
}

function offscreenOrigin(actor) {
    const volume = actor.get_paint_volume();
    let x, y, width, height;
    if (volume) {
        const origin = volume.get_origin();
        x = origin.x;
        y = origin.y;
        width = volume.get_width();
        height = volume.get_height();
    } else {
        const box = actor.get_allocation_box();
        x = box.x1;
        y = box.y1;
        width = box.x2 - box.x1;
        height = box.y2 - box.y1;
    }
    if (!(width > 0 && height > 0))
        return null;
    const paddedX = Math.ceil(x + width + 0.75) - Math.round(width) - 3;
    const paddedY = Math.ceil(y + height + 0.75) - Math.round(height) - 3;
    return volume
        ? [Math.trunc(paddedX), Math.trunc(paddedY)]
        : [Math.trunc(paddedX - x), Math.trunc(paddedY - y)];
}

const WindowAlphaMaskEffect = GObject.registerClass({
    GTypeName: 'BmsWindowAlphaMaskV2',
}, class WindowAlphaMaskEffect extends Clutter.OffscreenEffect {
    constructor(owner) {
        super();
        this.owner = owner;
        this._pipeline = null;
        this._locations = null;
    }

    _preparePipeline(pipeline) {
        if (pipeline === this._pipeline)
            return;
        // Layer 1 supplies a sampler only; the fragment snippet applies alpha.
        for (const layer of [1, 2]) {
            pipeline.set_layer_combine(layer, 'RGBA = REPLACE(PREVIOUS)');
            pipeline.set_layer_wrap_mode(layer, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
            pipeline.set_layer_filters(layer, Cogl.PipelineFilter.LINEAR,
                Cogl.PipelineFilter.LINEAR);
        }
        pipeline.add_snippet(Cogl.Snippet.new(
            Cogl.SnippetHook.FRAGMENT, DECLARATIONS, FRAGMENT));
        this._pipeline = pipeline;
        this._locations = Object.fromEntries([
            'origin', 'dx', 'dy', 'normalizer',
        ].map(key => [key, pipeline.get_uniform_location(`bms_mask_${key}`)]));
    }

    vfunc_paint_target(paintNode, paintContext) {
        const owner = this.owner;
        const snapshot = owner?.snapshot;
        const actor = this.get_actor();
        // Fail closed: a missing/stale mask must not reveal a solid rectangle.
        if (!owner || owner.destroyed || owner.capturing || !snapshot || !actor)
            return;
        try {
            const [valid, targetWidth, targetHeight] = this.get_target_size();
            const origin = offscreenOrigin(actor);
            if (!valid || !origin)
                return;
            const scale = Math.ceil(actor.get_resource_scale());
            if (!(scale > 0))
                return;
            const map = (x, y) => {
                const local = actor.apply_relative_transform_to_point(owner.windowActor,
                    point(x, y));
                // The snapshot includes the window actor's transform at capture.
                const parentX = snapshot.p0.x + local.x * snapshot.px.x + local.y * snapshot.py.x;
                const parentY = snapshot.p0.y + local.x * snapshot.px.y + local.y * snapshot.py.y;
                return [(parentX - snapshot.x) / snapshot.width,
                    (parentY - snapshot.y) / snapshot.height];
            };
            const p0 = map(...origin);
            const px = map(origin[0] + targetWidth / scale, origin[1]);
            const py = map(origin[0], origin[1] + targetHeight / scale);
            const pipeline = this.get_pipeline();
            pipeline.set_layer_texture(1, snapshot.texture);
            pipeline.set_layer_texture(2, snapshot.foregroundTexture);
            this._preparePipeline(pipeline);
            for (const [key, value] of [
                ['origin', p0],
                ['dx', [px[0] - p0[0], px[1] - p0[1]]],
                ['dy', [py[0] - p0[0], py[1] - p0[1]]],
            ])
                pipeline.set_uniform_float(this._locations[key], 2, 1, value);
            pipeline.set_uniform_1f(this._locations.normalizer, snapshot.normalizer);
            super.vfunc_paint_target(paintNode, paintContext);
        } catch (error) {
            owner.warn('paint', error);
        }
    }

    release() {
        if (this._pipeline) {
            this._pipeline.remove_layer(1);
            this._pipeline.remove_layer(2);
            this._pipeline = null;
        }
        this._locations = null;
        this.owner = null;
    }
});

/**
 * Attach a shape-preserving mask to metaWindow.blur_actor.
 * refresh() also handles replacement of metaWindow.blur_actor.
 */
export function attachWindowMask(metaWindow) {
    const windowActor = metaWindow.get_compositor_private();
    if (!windowActor)
        throw new Error('Window alpha mask requires a mapped window actor');

    const owner = {
        metaWindow, windowActor,
        destroyed: false, capturing: false, snapshot: null,
        blurActor: null, originalZ: null, cullingInhibited: false, effect: null, idleId: 0,
        connections: [], diagnostics: new Set(),

        warn(stage, error) {
            const message = `${stage}: ${error.message ?? error}`;
            if (this.diagnostics.has(message))
                return;
            this.diagnostics.add(message);
            console.warn(`[BMS window alpha mask] ${message}`);
        },

        connect(object, signal, callback) {
            const id = object.connect(signal, callback);
            this.connections.push([object, id]);
        },

        detachEffect() {
            if (this.blurActor && this.cullingInhibited) {
                try { this.blurActor.uninhibit_culling(); }
                catch (error) { this.warn('restore culling', error); }
            }
            this.cullingInhibited = false;
            if (this.effect) {
                try {
                    this.effect.get_actor()?.remove_effect(this.effect);
                } catch (error) {
                    this.warn('detach', error);
                }
                this.effect.release();
            }
            if (this.blurActor && this.originalZ !== null) {
                try { this.blurActor.z_position = this.originalZ; }
                catch (error) { this.warn('restore depth', error); }
            }
            this.effect = null;
            this.blurActor = null;
            this.originalZ = null;
        },

        ensureEffect() {
            const blur = this.metaWindow.blur_actor;
            if (blur === this.blurActor && this.effect)
                return;
            this.detachEffect();
            this.snapshot = null;
            if (!blur)
                return;
            const existing = blur.get_effects();
            this.effect = new WindowAlphaMaskEffect(this);
            this.blurActor = blur;
            // The generic wallpaper pipeline uses z=1. Perspective then shifts
            // its edges away from the client plane, particularly at screen edges.
            this.originalZ = blur.z_position;
            blur.z_position = 0;
            // This underlay must render completely into its offscreen texture.
            // Native opaque-region/redraw culling otherwise removes pixels
            // behind opaque clients even though BMS later reduces their opacity.
            blur.inhibit_culling();
            this.cullingInhibited = true;
            blur.get_children().forEach(child => child.queue_redraw());
            // Clutter paints the first effect outermost. Preserve other effects.
            existing.forEach(effect => blur.remove_effect(effect));
            try {
                blur.add_effect(this.effect);
            } finally {
                existing.forEach(effect => blur.add_effect(effect));
            }
        },

        capture() {
            if (this.destroyed || this.capturing)
                return;
            this.ensureEffect();
            if (!this.blurActor || !this.blurActor.visible || !this.windowActor.visible)
                return;

            const actor = this.windowActor;
            const [x, y] = actor.get_position();
            const [width, height] = actor.get_size();
            const opacity = actor.get_paint_opacity() / 255;
            if (!(width > 0 && height > 0 && opacity > 0.001)) {
                this.snapshot = null;
                return;
            }
            const parent = actor.get_parent();
            const p0 = actor.apply_relative_transform_to_point(parent, point(0, 0));
            const px = actor.apply_relative_transform_to_point(parent, point(width, 0));
            const py = actor.apply_relative_transform_to_point(parent, point(0, height));
            const restored = [];
            this.capturing = true;
            let content = null;
            let foregroundContent = null;
            try {
                const foreground = [];
                for (const child of actor.get_children()) {
                    const blur = child === this.blurActor || BLUR_NAMES.has(child.name);
                    if (blur) {
                        const visible = child.visible;
                        restored.push(() => child.visible = visible);
                        child.hide();
                    } else {
                        foreground.push(child);
                    }
                }
                // Capture the actual foreground first: shell-owned shadows
                // are not necessarily affected by BMS's child opacity setting.
                foregroundContent = actor.paint_to_content(null);
                for (const child of foreground) {
                    const childOpacity = child.opacity;
                    restored.push(() => child.opacity = childOpacity);
                    child.opacity = 255;
                }
                content = actor.paint_to_content(null);
            } finally {
                for (const restore of restored.reverse()) {
                    try {
                        restore();
                    } catch (error) {
                        this.warn('restore', error);
                    }
                }
                this.capturing = false;
            }
            const texture = content?.get_texture();
            const foregroundTexture = foregroundContent?.get_texture();
            if (!texture || !foregroundTexture) {
                this.snapshot = null;
                throw new Error('paint_to_content returned no texture');
            }
            this.snapshot = {
                content, texture, foregroundContent, foregroundTexture,
                x: Math.floor(x), y: Math.floor(y),
                width: Math.ceil(width), height: Math.ceil(height),
                p0, px: {x: (px.x - p0.x) / width, y: (px.y - p0.y) / width},
                py: {x: (py.x - p0.x) / height, y: (py.y - p0.y) / height},
                normalizer: 1 / opacity,
            };
            this.effect?.queue_repaint();
        },

        refresh() {
            if (this.destroyed || this.capturing || this.idleId || !this.metaWindow.blur_actor?.visible)
                return;
            this.idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.idleId = 0;
                try {
                    this.capture();
                } catch (error) {
                    this.snapshot = null;
                    this.effect?.queue_repaint();
                    this.warn('capture', error);
                }
                return GLib.SOURCE_REMOVE;
            });
        },

        destroy() {
            if (this.destroyed)
                return;
            this.destroyed = true;
            if (this.idleId)
                GLib.source_remove(this.idleId);
            this.idleId = 0;
            for (const [object, id] of this.connections) {
                if (GObject.signal_handler_is_connected(object, id))
                    object.disconnect(id);
            }
            this.connections = [];
            this.detachEffect();
            this.snapshot = null;
        },
    };

    // Only real content/geometry changes request captures. In particular, do
    // not listen for redraws or temporary child-opacity/visibility changes.
    for (const signal of [
        'damaged', 'notify::allocation', 'notify::visible', 'notify::opacity',
        'notify::scale-x', 'notify::scale-y', 'notify::translation-x',
        'notify::translation-y', 'notify::rotation-angle-z',
        'child-added', 'child-removed', 'real-resource-scale-changed',
    ])
        owner.connect(windowActor, signal, () => owner.refresh());
    owner.connect(windowActor, 'destroy', () => owner.destroy());
    owner.connect(metaWindow, 'size-changed', () => owner.refresh());
    owner.connect(metaWindow, 'position-changed', () => owner.refresh());
    owner.ensureEffect();
    owner.refresh();
    return owner;
}
