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
        const input = Gio.MemoryInputStream.new_from_bytes(output.steal_as_bytes());
        const image = GdkPixbuf.Pixbuf.new_from_stream(input, null);
        const data = image.get_pixels();
        const channels = image.get_n_channels();
        const stride = image.get_rowstride();
        const pixel = (x, y) => [...data.slice(y * stride + x * channels, y * stride + x * channels + 3)];
        const inside = pixel(550, 380), outside = pixel(500, 380);
        const visualDelta = Math.max(...inside.map((value, i) => Math.abs(value - outside[i])));
        await this.finish({captures, damages, uniqueTextures: textures.size,
            blurVisible: mask.blurActor?.visible, actorVisible: actor.visible,
            focused: global.display.focus_window?.get_title(), inside, outside, visualDelta});
    }

    async finish(result) {
        GLib.file_set_contents(GLib.getenv('BMS_MASK_TEST_RESULT'), JSON.stringify(result));
        try {
            await Main.extensionManager._callExtensionDisableWithRebase('blur-my-shell@eturkes.com');
        } catch (error) {
            console.error(`Mask test cleanup: ${error.message}`);
        }
        if (this.client)
            this.client.force_exit();
        await delay(500);
        global.context.terminate();
    }

    disable() {}
}
