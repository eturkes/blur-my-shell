# Native regression checks

Run from any directory with the host's GJS and GNOME Shell/Mutter libraries:

```sh
bash tests/run.sh --stylesheet build/source/stylesheet.css
```

The stylesheet path is relative to the repository, or may be absolute. Use `make check` to generate the stylesheet first; v76 no longer has an authored
`src/stylesheet.css`. Use the staged, flattened
stylesheet when checking a build. Set `GJS` to override `/usr/bin/gjs`.

The 31 checks execute production component methods with mocked scheduling and
rendering allocation, and query the real `St.ThemeNode` CSS cascade. They cover
deferred Dash to Panel startup/teardown, activation notifications for both
upstream and personal Dash to Panel UUIDs, opaque native popup suppression during
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

## Private Dash to Panel regression evidence

At `a81e24d`, the expanded runner passes 28/29 checks and fails the new
`dash-to-panel@eturkes.com` activation case. The upstream identity, unrelated
extension, and inactive-state controls pass. Recognizing both active Dash to
Panel identities brings the unchanged suite to 29/29.

## Overview color regression evidence

At `d1d7cd56953cfb06a4c09e3fdca5c9f0d5e7d5cd`, the expanded `make check`
failed with three new state/cascade failures (22/25 checks passed). The checks
cover both stylesheet load orders, panel interaction states, privacy/recording/
sharing preservation, and all three overview search styles. The state-specific
CSS correction brings the same suite to 25/25 without changing the original
checks or their requirements.

## Stable v76 update

The production modules moved to `components/panel/` and `popup/surface/`.
Fixtures now use real panel discovery, style helpers, and compositor-later
scheduling, replacing GPU allocation only. All 29 existing behavior requirements
are retained. Before the overview CSS adjustment, the updated suite passed 27/29:
upstream placeholder and light-style typing colors failed both load orders.
Preserving the personal white typing/placeholder rules restores 29/29.

## Overview light-search correction

The previous white-text requirement for every Overview style was incorrect for
v76's light search backgrounds. The corrected checks require dark text/caret/
selection and a dark placeholder in light mode; dark and transparent modes retain
light colors. Both ancestor and entry-local style classes are checked across
normal, hover, focus, and combined states in both stylesheet load orders.

## Softer light controls and search-result focus

Search result focus-ring checks use Luminus-like important inset shadows in both
load orders, including focus/hover and focus/active combinations. Background
focus highlights must remain visible, and entry/app-grid focus rings must stay
intact. All 31 checks pass. The user rebooted into `76-personal.3` and reported
that the desktop appearance looks good on 2026-10-21.
