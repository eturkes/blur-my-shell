# Native regression checks

Run from any directory with the host's GJS and GNOME Shell/Mutter libraries:

```sh
bash tests/run.sh --stylesheet build/source/stylesheet.css
```

The stylesheet path is relative to the repository, or may be absolute. Without
`--stylesheet`, the runner uses the authored `src/stylesheet.css`; its imports
intentionally reproduce the upstream St cascade bug. Use the staged, flattened
stylesheet when checking a build. Set `GJS` to override `/usr/bin/gjs`.

The 21 checks execute production component methods with mocked scheduling and
rendering allocation, and query the real `St.ThemeNode` CSS cascade. They cover
deferred Dash to Panel startup/teardown, opaque native popup suppression during
fades, retained translucent/explicit popup styling, and both stylesheet load
orders. No running Shell, GUI interaction, settings mutation, Node.js, or Python
is required. They do not replace compositor pixel/rendering checks.

## Original failure evidence

Observed before importing the fixes, at revision
`99660f4e87eab4ea1e02e39e79cebf7cfa320dbb`:

```sh
GI_TYPELIB_PATH=/usr/lib64/gnome-shell:/usr/lib64/mutter-18 \
LD_LIBRARY_PATH=/usr/lib64/gnome-shell:/usr/lib64/mutter-18 \
/usr/bin/gjs -m tests/regressions.js
```

Exit status: **1**. Thirteen regression cases failed; eight preservation controls
passed. Failures included missing deferred light-text styling, actors recreated
after disable, blur under opaque native menus/OSDs/notifications (including
fades), and direct theme rules overriding imported BMS CSS in both load orders.

## Headless St diagnostic

On GNOME Shell 50, constructing `St.ThemeContext` without a live Clutter backend
works for these native color queries, but its finalizer emits a GLib-GObject
null-backend disconnect diagnostic at process teardown. The runner neither
filters that diagnostic nor changes the tests' exit status. A compositor test
environment is required when running with fatal GLib criticals enabled.
