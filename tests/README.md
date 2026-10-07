# Native regression checks

Run from any directory with the host's GJS and GNOME Shell/Mutter libraries:

```sh
bash tests/run.sh --stylesheet build/source/stylesheet.css
```

The stylesheet path is relative to the repository, or may be absolute. Without
`--stylesheet`, the runner uses the authored `src/stylesheet.css`; its imports
intentionally reproduce the upstream St cascade bug. Use the staged, flattened
stylesheet when checking a build. Set `GJS` to override `/usr/bin/gjs`.

The 25 checks execute production component methods with mocked scheduling and
rendering allocation, and query the real `St.ThemeNode` CSS cascade. They cover
deferred Dash to Panel startup/teardown, opaque native popup suppression during
fades, retained translucent/explicit popup styling, and both stylesheet load
orders, including overview panel states and focused/hovered search text,
selection and caret colors. No running Shell, GUI interaction, settings mutation, Node.js, or Python
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

## Overview color regression evidence

At `d1d7cd56953cfb06a4c09e3fdca5c9f0d5e7d5cd`, the expanded `make check`
failed with three new state/cascade failures (22/25 checks passed). The checks
cover both stylesheet load orders, panel interaction states, privacy/recording/
sharing preservation, and all three overview search styles. The state-specific
CSS correction brings the same suite to 25/25 without changing the original
checks or their requirements.
