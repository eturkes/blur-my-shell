// Native GJS tests: no Shell session, settings writes, or display connection.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import System from 'system';

const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const tests = [];
function test(name, callback) { tests.push([name, callback]); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function equal(actual, expected, message) {
    assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
}

// Evaluate production class methods, replacing only their imported dependencies.
// Rendering factories are stubbed below; scheduling and styling methods remain real.
function loadClass(path, name, dependencies) {
    const [, bytes] = root.resolve_relative_path(path).load_contents(null);
    const source = new TextDecoder().decode(bytes)
        .replace(/^import\s+[\s\S]*?;\s*$/gm, '')
        .replace(/^export\s+/gm, '');
    return new Function(...Object.keys(dependencies), `${source}\nreturn ${name};`)
        (...Object.values(dependencies));
}

class Actor {
    constructor() { this.classes = new Set(); this.visible = false; this.opacity = 255; }
    add_style_class_name(name) { this.classes.add(name); }
    remove_style_class_name(name) { this.classes.delete(name); }
    has_style_class_name(name) { return this.classes.has(name); }
    get_children() { return []; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; }
}

class Connections {
    constructor() { this.records = new Map(); this.nextId = 1; }
    connect(object, signals, handler) {
        const ids = (Array.isArray(signals) ? signals : [signals]).map(signal => {
            const id = this.nextId++;
            const records = this.records.get(object) ?? [];
            records.push({id, signal, handler});
            this.records.set(object, records);
            return id;
        });
        return Array.isArray(signals) ? ids : ids[0];
    }
    disconnect_all_for(object) { this.records.delete(object); }
    disconnect_all() { this.records.clear(); }
    get size() { return [...this.records.values()].reduce((sum, ids) => sum + ids.length, 0); }
}

function panelFixture(light, count) {
    const idles = [];
    const Main = {
        panel: new Actor(), uiGroup: new Actor(), extensionManager: {},
        layoutManager: {}, sessionMode: {},
        overview: {_overview: {_controls: {_appDisplay: {}}}},
    };
    const panels = Array.from({length: count}, (_, i) => i === 0 ? Main.panel : new Actor());
    const global = {
        dashToPanel: {panels: panels.map(panel => ({panel}))},
        display: {}, window_group: {}, window_manager: {},
    };
    const PanelBlur = loadClass('src/components/panel.js', 'PanelBlur', {
        Main, global, GLib: {
            PRIORITY_DEFAULT_IDLE: 0, SOURCE_REMOVE: false,
            idle_add(_priority, callback) { idles.push(callback); return idles.length; },
        },
    });
    const connections = new Connections();
    const settings = {
        panel: {FORCE_LIGHT_TEXT: light, BLUR: true, UNBLUR_IN_OVERVIEW: false,
            OVERRIDE_BACKGROUND: false, OVERRIDE_BACKGROUND_DYNAMICALLY: false},
        dash_to_panel: {BLUR_ORIGINAL_PANEL: true}, hidetopbar: {COMPATIBILITY: false},
    };
    const component = new PanelBlur(connections, settings, {});
    // Replace GPU allocation only. maybe_blur_panel, enable/disable, the idle
    // callback, connection rebinding, and light-text application stay production.
    component.blur_panel = panel => component.actors_list.push({
        widgets: {panel, background: new Actor(), background_group: new Actor()},
    });
    return {component, connections, Main, drain() {
        let remaining = 20;
        while (idles.length) {
            assert(--remaining > 0, 'panel scheduled an endless idle loop');
            idles.shift()();
        }
    }};
}

for (const light of [false, true]) {
    for (const count of [1, 3]) {
        test(`deferred DTP: force-light=${light}, panels=${count}`, () => {
            const fixture = panelFixture(light, count);
            const {component, connections, Main} = fixture;
            component.enable();
            equal(component.actors_list.length, 0, 'creation must remain deferred');
            fixture.drain();
            equal(component.actors_list.length, count, 'each DTP panel is created once');
            equal(Main.uiGroup.has_style_class_name('panel-light-text'), light,
                'light-text preference must apply after deferred panel creation');
            const connectionCount = connections.size;
            component.blur_dtp_panels();
            fixture.drain();
            equal(component.actors_list.length, count, 'repeat notification must not duplicate panels');
            equal(connections.size, connectionCount, 'repeat notification must not duplicate signals');
            component.disable();
            equal(Main.uiGroup.has_style_class_name('panel-light-text'), false, 'disable clears style');
            equal(connections.size, 0, 'disable disconnects signals');
        });
    }
}

test('deferred DTP: disable before idle must not resurrect panels', () => {
    const fixture = panelFixture(true, 3);
    fixture.component.enable();
    fixture.component.disable();
    fixture.drain();
    equal(fixture.component.actors_list.length, 0, 'disabled component must not create actors');
    equal(fixture.connections.size, 0, 'disabled component must not reconnect signals');
    equal(fixture.Main.uiGroup.has_style_class_name('panel-light-text'), false, 'disabled style');
});

const PopupBlurSurface = loadClass('src/components/popup/blur_surface.js', 'PopupBlurSurface', {St});
function popupFixture({alpha = 255, opacity = 255, override = false, gradient = St.GradientType.NONE,
    image = null, borderImage = null, kind = 'popup-menu-content', staticBlur = true} = {}) {
    const target = new Actor();
    target.classes.add(kind);
    target.opacity = opacity;
    target.get_theme_node = () => ({
        get_background_color: () => ({alpha}),
        get_background_gradient: () => [gradient, null, null],
        get_background_image: () => image,
        get_border_image: () => borderImage,
    });
    const surface = Object.create(PopupBlurSurface.prototype);
    const actor = new Actor();
    const geometry = {width: 200, height: 100};
    Object.assign(surface, {
        actor, blur_actor: actor, target, root_actor: target,
        settings: {popup: {OVERRIDE_BACKGROUND: override}}, static_blur: staticBlur,
        style: {has_any_style_class: (subject, classes) => classes.some(c => subject.classes.has(c))},
        static_actor: {background_group: {},
            has_opacity: value => actor.opacity === value,
            set_opacity: value => actor.opacity = value},
        fade: {get_opacity: () => opacity, set_opacity: value => actor.opacity = value},
        pipeline: {set_opacity_factor() {}},
        transitions: {get_state: () => ({geometry: false, running: false}), complete_state: s => s},
        placement: {
            get_surface_geometry: () => geometry,
            get_unclipped_monitor_surface_geometry: () => geometry,
            has_surface_geometry_changed: () => false,
            has_valid_geometry: () => true,
            update_surface_geometry: () => true,
            prepare_visible_geometry: () => true,
            hide() {},
        },
        is_visible: () => true,
        set_actor_position() {}, queue_repaint() {}, queue_transition_update() {},
    });
    return surface;
}

for (const kind of ['popup-menu-content', 'quick-settings', 'osd-window', 'notification-banner']) {
    for (const opacity of [255, 96]) {
        test(`opaque native ${kind}, actor opacity=${opacity}: no blur underlay`, () => {
            const surface = popupFixture({kind, opacity});
            surface.update();
            equal(surface.actor.visible, false, 'opaque native surface must not acquire a halo');
        });
    }
}

for (const [name, options] of [
    ['translucent theme', {alpha: 128}],
    ['transparent theme', {alpha: 0}],
    ['explicit BMS override', {override: true}],
    ['gradient theme', {gradient: St.GradientType.VERTICAL}],
    ['background image', {image: {}}],
    ['border image', {borderImage: {}}],
]) {
    test(`popup retains blur: ${name}`, () => {
        const surface = popupFixture(options);
        surface.update();
        equal(surface.actor.visible, true, 'other popup styling must retain its blur');
    });
}

if (ARGV.length && (ARGV.length !== 2 || ARGV[0] !== '--stylesheet')) {
    printerr('Usage: gjs -m tests/regressions.js [--stylesheet PATH]');
    System.exit(2);
}
const cssPath = ARGV[1] ?? 'src/stylesheet.css';
const stylesheet = GLib.path_is_absolute(cssPath)
    ? Gio.File.new_for_path(cssPath) : root.resolve_relative_path(cssPath);
const competing = root.resolve_relative_path('tests/fixtures/competing-theme.css');
for (const bmsFirst of [false, true]) {
    test(`native St cascade: BMS loaded ${bmsFirst ? 'first' : 'last'}`, () => {
        const context = new St.ThemeContext();
        const theme = new St.Theme();
        for (const file of bmsFirst ? [stylesheet, competing] : [competing, stylesheet])
            theme.load_stylesheet(file);
        const node = (parent, id, classes, pseudo = null) => St.ThemeNode.new(
            context, parent, theme, St.Widget.$gtype, id, classes, pseudo, '');
        const ui = node(null, null, 'panel-light-text overview-components-transparent');
        const panel = node(ui, 'panel', null);
        const button = node(panel, null, 'panel-button');
        equal(button.get_foreground_color().to_string(), '#f6f5f4ff', 'panel text color');
        const tile = node(ui, null, 'overview-tile', 'hover');
        equal(tile.get_background_color().to_string(), '#e6e6e614', 'overview hover translucency');
    });
}

// Interaction-state regressions must not depend on stylesheet load order.
for (const bmsFirst of [false, true]) {
    const order = bmsFirst ? 'first' : 'last';
    function fixture() {
        const context = new St.ThemeContext();
        const theme = new St.Theme();
        for (const file of bmsFirst ? [stylesheet, competing] : [competing, stylesheet])
            theme.load_stylesheet(file);
        return (parent, id, classes, pseudo = null, type = St.Widget.$gtype) =>
            St.ThemeNode.new(context, parent, theme, type, id, classes, pseudo, '');
    }
    test(`panel states stay light in overview: BMS loaded ${order}`, () => {
        const node = fixture();
        const ui = node(null, null, 'panel-light-text');
        for (const panelState of [null, 'overview']) {
            const panel = node(ui, 'panel', null, panelState);
            for (const state of [null, 'hover', 'focus', 'active', 'checked', 'active hover', 'checked hover', 'focus hover']) {
                for (const [classes, color] of [
                    ['panel-button', '#f6f5f4ff'],
                    ['panel-button clock-display', '#f6f5f4ff'],
                    ['panel-button screen-recording-indicator', '#f6f5f4ff'],
                    ['panel-button screen-sharing-indicator', '#282828ff'],
                ]) {
                    const button = node(panel, null, classes, state);
                    equal(button.get_foreground_color().to_string(), color, `${panelState}/${state}/${classes}`);
                    equal(node(button, null, 'system-status-icon').get_foreground_color().to_string(), color,
                        'status icon inherits the indicator foreground');
                }
                const activities = node(panel, 'panelActivities', 'panel-button', state);
                equal(node(activities, null, 'workspace-dot').get_background_color().to_string(), '#f6f5f4ff',
                    'workspace indicator stays light');
            }
            equal(node(panel, null, 'privacy-indicator').get_foreground_color().to_string(), '#e66100ff',
                'privacy indicator keeps its warning color');
        }
    });
    test(`search typing states stay white: BMS loaded ${order}`, () => {
        const node = fixture();
        for (const variant of ['transparent', 'light', 'dark']) {
            const ui = node(null, null, `overview-components-${variant}`);
            for (const state of [null, 'hover', 'focus', 'focus hover']) {
                const entry = node(ui, null, 'search-entry', state);
                equal(entry.get_foreground_color().to_string(), '#ffffffff', `${variant}/${state} text`);
                equal(entry.get_color('caret-color').to_string(), '#ffffffff', `${variant}/${state} caret`);
                equal(entry.get_color('selected-color').to_string(), '#ffffffff', `${variant}/${state} selection`);
                const hint = node(entry, null, 'hint-text', null, St.Label.$gtype);
                equal(hint.get_foreground_color().to_string(), '#ffffffb3', 'placeholder remains translucent white');
            }
        }
    });
}

let failed = 0;
for (const [name, callback] of tests) {
    try {
        callback();
        print(`PASS ${name}`);
    } catch (error) {
        failed++;
        printerr(`FAIL ${name}: ${error.message}`);
    }
}
print(`${tests.length - failed}/${tests.length} checks passed; ${failed} failed`);
// Report assertion status explicitly. Standalone St.ThemeContext can emit a
// backend-disconnect diagnostic at teardown; see tests/README.md.
System.exit(failed ? 1 : 0);
