// Loaded only by panel-rebase.sh in a private, headless Shell.
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const delay = () => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
function assert(value, message) { if (!value) throw new Error(message); }

export default class PanelRebaseProbe extends Extension {
    enable() {
        this.source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.source = 0;
            this.run().then(result => this.finish(result), error => this.finish({error: `${error.message}\n${error.stack}`}));
            return GLib.SOURCE_REMOVE;
        });
    }

    async run() {
        while (Main.layoutManager._startingUp) await delay();
        const manager = Main.extensionManager;
        // BMS stays enabled while disabling the target rebases Luminus + DTP.
        for (const uuid of ['blur-my-shell@eturkes.com', 'panel-rebase-target@tests',
            'luminus-desktop@eturkes.com', 'dash-to-panel@eturkes.com']) {
            await manager._callExtensionEnable(uuid);
            const extension = manager.lookup(uuid);
            assert(extension.state === 1, `${uuid} failed to activate: state=${extension.state}, ${extension.error}`);
        }
        Main.overview.hide();
        for (let i = 0; i < 10; i++) await delay();
        const snapshot = () => {
            const colors = {};
            for (const role of ['dateMenu', 'quickSettings']) {
                const color = Main.panel.statusArea[role].get_theme_node().get_foreground_color();
                colors[role] = color.to_string();
                assert(color.red >= 240 && color.green >= 240 && color.blue >= 240 && color.alpha === 255,
                    `${role} is not white: ${colors[role]}`);
            }
            const component = global.blur_my_shell._panel_blur;
            const panels = global.dashToPanel.panels.map(({panel}) => panel);
            assert(panels.length > 0, 'no DTP panels');
            for (const panel of panels) {
                assert(panel.mapped, 'DTP panel is not mapped');
                const actors = component.actors_list.find(a => a.widgets.panel === panel);
                assert(actors, `mapped DTP panel has no BMS actors; variant=${Main.getStyleVariant()}, colors=${JSON.stringify(colors)}`);
                assert(actors.widgets.panel_box.has_style_class_name('panel-light-text'), 'missing light-text class');
            }
            assert(component.discovery.dash_to_panel === global.dashToPanel, 'stale DTP emitter');
            return colors;
        };
        const before = snapshot();
        const oldEmitter = global.dashToPanel;
        await manager._callExtensionDisableWithRebase('panel-rebase-target@tests');
        for (let i = 0; i < 10; i++) await delay();
        assert(global.dashToPanel !== oldEmitter, 'rebase did not replace DTP');
        return {before, after: snapshot()};
    }

    finish(result) {
        GLib.file_set_contents(GLib.getenv('PANEL_REBASE_RESULT'), JSON.stringify(result));
        global.context.terminate();
    }

    disable() {
        if (this.source) GLib.Source.remove(this.source);
        this.source = 0;
    }
}
