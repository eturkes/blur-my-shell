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
});
app.run([]);
