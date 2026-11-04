imports.gi.versions.Gtk = '4.0';
const {Gtk, GLib} = imports.gi;
const app = new Gtk.Application({application_id: 'local.codex.MaskChurn'});
app.connect('activate', () => {
    let n = 0;
    const win = new Gtk.ApplicationWindow({application: app, title: 'Mask churn background', default_width: 1000, default_height: 700});
    const label = new Gtk.Label({label: 'Initial frame'});
    win.set_child(label);
    win.present();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => { label.set_label(`frame ${n++}`); return GLib.SOURCE_CONTINUE; });
    const other = new Gtk.ApplicationWindow({application: app, title: 'Mask churn foreground', default_width: 260, default_height: 120});
    other.set_child(new Gtk.Label({label: 'Foreground'}));
    other.present();
    const commandPath = GLib.getenv('BMS_MASK_TEST_COMMAND');
    let dialog = null;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        if (!GLib.file_test(commandPath, GLib.FileTest.EXISTS))
            return GLib.SOURCE_CONTINUE;
        const [, contents] = GLib.file_get_contents(commandPath);
        GLib.unlink(commandPath);
        const command = new TextDecoder().decode(contents);
        if (command === 'open' && !dialog) {
            dialog = new Gtk.Window({title: 'Mask churn confirmation', transient_for: win, modal: true});
            dialog.set_child(new Gtk.Label({label: 'Close Window?'}));
            dialog.present();
        } else if (command === 'close' && dialog) {
            dialog.destroy();
            dialog = null;
        }
        return GLib.SOURCE_CONTINUE;
    });
});
app.run([]);
