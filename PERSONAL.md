# Personal maintenance on Aeon

This fork preserves the working local fixes for **GNOME Shell 50.5** and Luminus.
It is for this machine, not a release distributed through extensions.gnome.org.

## Source of truth

- Checkout: `~/Projects/blur-my-shell`
- Personal branch: `master` on `git@github.com:eturkes/blur-my-shell.git`
- Upstream: `https://github.com/aunetx/blur-my-shell.git`, branch `master`
- Personal UUID: `blur-my-shell@eturkes.com`
- Settings schema/path and gettext domain stay upstream-compatible, so the
  existing preferences and translations are reused.

`76-personal.3` softens the light Overview search field and app-grid page arrows
to 42% white (60% on focus/hover; arrows use 72% when pressed). Search result
cards are unchanged. Keyboard-focused search results retain their background
highlight but no longer show Luminus's blue inset ring; the entry, dash and
app-grid focus rings are unchanged. No Luminus edits are required.
All 31 native checks pass; the user rebooted and accepted the appearance on
2026-10-21.

`76-personal.2` restores dark Overview search text, caret, and placeholder for
light search surfaces. Dark/transparent fields keep light text. The v76 update's
blanket white override was incorrect; native checks now distinguish styles and
cover both ancestor and entry-local style classes in both stylesheet load orders.

`76-personal.1` merges upstream stable **v76** (not unreleased `master`).
The private Dash to Panel identities, window alpha mask, opaque native popup
suppression, and overview color fixes are retained in v76's reorganized modules.
Upstream now bundles the component stylesheets directly; the personal build uses
that ordered list and packages all new source directories. The 29 native checks
pass on GNOME Shell 50.5; fresh-login desktop/compositor checks remain pending.

`75-personal.2` recognizes both `dash-to-panel@jderose9.github.com` and
`dash-to-panel@eturkes.com` when reconnecting panel recreation notifications.
The private Dash to Panel fork lives in `~/Projects/dash-to-panel`; see its
`PERSONAL.md` before switching identities. Deploy this companion build before
enabling the private panel. Both builds need a fresh login to load changed code.

The imported code fixes cover deferred panel styling, exact application-surface
masking (including compositing and redraw culling), and suppression of redundant
blur beneath opaque native popups. CSS remains split into upstream component
files in `src/styles/`. The build concatenates the ordered `STYLESHEETS` list
into the packaged stylesheet because GNOME St gives imported rules lower
priority than direct extension CSS.
Do not edit `build/source/stylesheet.css`.

The initial fork import preserved the running desktop without switching UUIDs.
The one-time migration below selects the personal installation. The upstream
`blur-my-shell@aunetx` identity remains subject to upstream extension updates;
the private UUID is what isolates the personal build.

## Build and check

Use host GNOME tools, not the Debian container:

```sh
cd ~/Projects/blur-my-shell
make check
```

Dependencies: GNU Make, GJS, GNOME Shell/Mutter runtime libraries,
`gnome-extensions`, gettext (`msgfmt`), `glib-compile-schemas`, and `zip`.
`make check` builds the archive, validates schemas, and runs native regressions.
See [tests/README.md](tests/README.md) for scope and original failure evidence.
The artifact is `build/blur-my-shell@eturkes.com.shell-extension.zip`.

The stylesheet bundle preserves the explicit order in the Makefile. Review that
list and any newly introduced CSS imports or relative asset URLs before updating.

## One-time migration

Save work first; a fresh login is required. Both UUIDs register the same GNOME
GTypes and share a global object and DBus service. Disabling upstream does not
unregister its classes, so **do not enable the personal UUID in the same session
in which upstream has already loaded**. Never enable both copies together.

1. Build and check with `make check`.
2. Back up the current preferences and installed extension to a private local
   backup outside Git. Do not commit settings dumps or desktop captures.
3. Run `make install`. This installs the personal archive, but does not enable
   it or remove the upstream installation. The installer uses a temporary cache
   beside the destination to avoid cross-filesystem/subvolume directory moves.
4. Run `gnome-extensions disable blur-my-shell@aunetx`.
5. Log out and back in.
6. Run `gnome-extensions enable blur-my-shell@eturkes.com`.
7. Perform the desktop checks below. Once satisfied, remove the disabled
   upstream copy with `gnome-extensions uninstall blur-my-shell@aunetx`.

Extension Manager can enable/disable the personal UUID, but does not deploy
GitHub changes. Luminus remains separately installed from its own fork.

## Routine upstream updates

Keep `update-git` unchanged for now. Updating this graphics extension should be
an explicit review/build/install operation, not an unattended merge or install.

```sh
cd ~/Projects/blur-my-shell
git status --short                 # start with a clean worktree
git fetch upstream
git log --oneline HEAD..upstream/master
git switch -c update/upstream-YYYYMMDD
git merge upstream/master         # preserve local patches; resolve deliberately
make check
```

Review changes particularly in `components/applications.js`, `components/panel.js`,
`components/popup/`, `effects/window_mask.js`, and the theme/build files. Bump the
personal `version-name` when preparing a new build. Keep `shell-version` limited
to versions actually checked; disabling GNOME's compatibility check is not a
substitute for testing a new Shell major version.

Commit the reviewed source, metadata, and test changes on the update branch,
including the failing-before/fixed-check evidence in the commit message.

Install with `make install`, then log out/in to test newly imported JavaScript.
Toggling an extension does not reliably reload its modules. Keep the previous
known-good archive and Git revision until the new build is accepted.

After the desktop checks succeed:

```sh
git switch master
git merge --ff-only update/upstream-YYYYMMDD
git tag -a personal-YYYYMMDD -m 'Checked on Aeon / GNOME VERSION'
git push origin master
git push origin personal-YYYYMMDD
```

Only tag a build as checked after the desktop checks, not merely because it
compiled. If upstream changes overlap a regression check, retain the existing
check and fix the implementation; do not lower its requirements to get green.

## Desktop checks after deployment or a GNOME upgrade

- White panel/tray icons survive login and toggling the extension.
- Focused windows retain their normal opacity; unfocused windows retain the
  configured blur/opacity without adding coverage outside their native shape.
- Check all four corners on GTK and Chromium/Electron windows, including moving,
  resizing, maximizing/restoring, overview, and monitor/scale changes in use.
- System/tray menus keep keyboard focus and their native opaque appearance.
- Volume/brightness OSDs have no extra backdrop border and do not steal focus.
- Check an animated/video window for frame-rate or GPU-load regressions. The
  alpha mask captures rendered window surfaces; performance is not covered by
  the headless tests.
- Check Shell logs and `gnome-extensions info blur-my-shell@eturkes.com` for errors.

The native pixel checks used while developing the mask compared rendered edge
coverage with the window's own alpha at all four corners. A successful build or
mocked test does not replace that visual/compositor check.

## Rollback

Disable the personal UUID if it disrupts the desktop. Install the saved
known-good personal archive with `gnome-extensions install --force ARCHIVE`, then
log out/in before enabling it again. Alternatively build a known-good Git tag
in a separate worktree and install its archive. Preferences normally remain;
restore the private settings backup only if a preference change caused the issue.

To return to upstream, reverse the UUID migration across a fresh login. Do not
hot-switch between the two versions. Keep the fork and backup until upstream has
actually incorporated or superseded the fixes needed on this machine.
