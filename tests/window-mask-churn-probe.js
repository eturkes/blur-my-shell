// Loaded by window-mask-churn.sh in a private headless GNOME Shell session.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import Shell from 'gi://Shell';
import System from 'system';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

export default class MaskChurnProbe extends Extension {
    enable() {
        this.run().catch(error => this.finish({error: `${error.message}\n${error.stack}`}));
    }

    async run() {
        while (Main.layoutManager._startingUp)
            await delay(100);
        await Main.extensionManager._callExtensionEnable('blur-my-shell@eturkes.com');
        const ext = Main.extensionManager.lookup('blur-my-shell@eturkes.com');
        if (ext.state !== 1)
            throw new Error(`BMS state=${ext.state}: ${ext.error}`);

        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        launcher.setenv('WAYLAND_DISPLAY', 'bms-mask-churn-test', true);
        this.client = launcher.spawnv(['/usr/bin/gjs', GLib.getenv('BMS_MASK_TEST_CLIENT')]);
        let mask;
        for (let i = 0; i < 100 && !mask; i++) {
            await delay(100);
            mask = [...global.blur_my_shell._applications_blur.meta_windows]
                .find(w => w.get_title() === 'Mask churn background')?._bms_window_alpha_mask;
        }
        if (!mask)
            throw new Error('Test window did not obtain a static blur mask');

        Main.overview.hide();
        mask.metaWindow.activate(global.get_current_time());
        await delay(1000);
        let captures = 0;
        let damages = 0;
        const textures = new Set();
        const originalCapture = mask.capture;
        mask.capture = function (...args) {
            captures++;
            const result = originalCapture.apply(this, args);
            if (this.snapshot) {
                textures.add(System.addressOfGObject(this.snapshot.texture));
                textures.add(System.addressOfGObject(this.snapshot.foregroundTexture));
            }
            return result;
        };
        const actor = mask.windowActor;
        const damageId = actor.connect('damaged', () => damages++);
        await delay(3000);
        mask.capture = originalCapture;
        actor.disconnect(damageId);

        // The large test window is focused and covers the small one. A nested
        // paint bug can incorrectly draw the covered window through it. Sample
        // two otherwise identical background pixels, one inside the hidden
        // small window's rectangle and one outside it.
        const output = Gio.MemoryOutputStream.new_resizable();
        const screenshot = new Shell.Screenshot();
        await new Promise((resolve, reject) => screenshot.screenshot_area(
            0, 0, 1280, 800, output, (object, result) => {
                try {
                    object.screenshot_area_finish(result);
                    output.close(null);
                    resolve();
                } catch (error) { reject(error); }
            }));
        const screenshotBytes = output.steal_as_bytes();
        const screenshotPath = GLib.getenv('BMS_MASK_TEST_SCREENSHOT');
        if (screenshotPath)
            GLib.file_set_contents(screenshotPath, screenshotBytes.get_data());
        const input = Gio.MemoryInputStream.new_from_bytes(screenshotBytes);
        const image = GdkPixbuf.Pixbuf.new_from_stream(input, null);
        const data = image.get_pixels();
        const channels = image.get_n_channels();
        const stride = image.get_rowstride();
        const pixel = (x, y) => [...data.slice(y * stride + x * channels, y * stride + x * channels + 3)];
        const inside = pixel(550, 380), outside = pixel(500, 380);
        const visualDelta = Math.max(...inside.map((value, i) => Math.abs(value - outside[i])));
        const focused = global.display.focus_window?.get_title();
        // Match the user's dynamic-opacity behavior: focused windows have no
        // blur, and regain a correctly updated mask after focus moves away.
        const appSettings = global.blur_my_shell._settings.applications;
        appSettings.DYNAMIC_OPACITY = true;
        await delay(400);
        const focusHidesBlur = !mask.blurActor.visible;
        const other = [...global.blur_my_shell._applications_blur.meta_windows]
            .find(w => w.get_title() === 'Mask churn foreground');
        if (!other)
            throw new Error('Foreground test window disappeared');
        other.activate(global.get_current_time());
        await delay(600);
        const unfocusedShowsBlur = mask.blurActor.visible && !!mask.snapshot;
        appSettings.DYNAMIC_OPACITY = false;
        mask.metaWindow.activate(global.get_current_time());
        await delay(400);
        const frame = mask.metaWindow.get_frame_rect();
        const beforeSize = actor.get_size();
        const resizeTextures = new Set();
        const observedSizes = new Set();
        for (let i = 0; i < 12; i++) {
            mask.metaWindow.move_resize_frame(true, frame.x + 30, frame.y + 20, 800 + i * 4, 500 + i * 3);
            await delay(80);
            observedSizes.add(actor.get_size().join('x'));
            if (mask.snapshot) {
                resizeTextures.add(System.addressOfGObject(mask.snapshot.texture));
                resizeTextures.add(System.addressOfGObject(mask.snapshot.foregroundTexture));
            }
        }
        await delay(400);
        const afterSize = actor.get_size();
        const snapshotSize = mask.snapshot ? [mask.snapshot.width, mask.snapshot.height] : null;
        const resized = beforeSize.some((value, i) => value !== afterSize[i]);
        const sizeMatches = snapshotSize?.every((value, i) => value === Math.ceil(afterSize[i])) ?? false;
        mask.metaWindow.move_resize_frame(true, 0, 30, 1270, 700);
        await delay(1200);
        const grownSize = actor.get_size();
        const grownSnapshot = mask.snapshot ? [mask.snapshot.width, mask.snapshot.height] : null;
        const grown = grownSize[0] > beforeSize[0];
        const grownMatches = grownSnapshot?.every((value, i) => value === Math.ceil(grownSize[i])) ?? false;
        this.testMask = mask;
        this.testWindow = mask.metaWindow;
        await this.finish({captures, damages, uniqueTextures: textures.size,
            blurVisible: mask.blurActor?.visible, actorVisible: actor.visible,
            focused, inside, outside, visualDelta, resized, sizeMatches, beforeSize, afterSize, snapshotSize,
            resizeSteps: observedSizes.size, resizeTextures: resizeTextures.size, grown, grownMatches, grownSize,
            focusHidesBlur, unfocusedShowsBlur});
    }

    async finish(result) {
        try {
            await Main.extensionManager._callExtensionDisableWithRebase('blur-my-shell@eturkes.com');
            if (this.testMask)
                result.cleaned = this.testMask.destroyed && !this.testWindow._bms_window_alpha_mask
                    && this.testMask.targets == null && this.testMask.snapshot == null;
        } catch (error) {
            result.error = `Mask test cleanup: ${error.message}`;
        }
        GLib.file_set_contents(GLib.getenv('BMS_MASK_TEST_RESULT'), JSON.stringify(result));
        if (this.client)
            this.client.force_exit();
        await delay(500);
        global.context.terminate();
    }

    disable() {}
}
