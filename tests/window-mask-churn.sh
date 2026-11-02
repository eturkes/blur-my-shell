#!/usr/bin/env bash
# Private compositor; never touches the current session's settings or windows.
set -euo pipefail

task_repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
task_source=${1:-"$task_repo/build/source"}
test -f "$task_source/metadata.json" || { printf 'Build first with make build.\n' >&2; exit 2; }
task_root=$(mktemp -d "${TMPDIR:-/tmp}/bms-mask-churn.XXXXXXXX")
cleanup() { rm -r -- "$task_root" 2>/dev/null || true; }
trap cleanup EXIT
export XDG_CONFIG_HOME="$task_root/config" XDG_CACHE_HOME="$task_root/cache"
export XDG_DATA_HOME="$task_root/data" XDG_STATE_HOME="$task_root/state"
export XDG_RUNTIME_DIR="$task_root/runtime" GSETTINGS_BACKEND=keyfile
export BMS_MASK_TEST_RESULT="$task_root/result.json"
export BMS_MASK_TEST_CLIENT="$task_repo/tests/window-mask-churn-client.js"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
task_ext="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p "$task_ext/mask-churn-probe@tests"
cp -a "$task_source" "$task_ext/blur-my-shell@eturkes.com"
cp "$task_repo/tests/window-mask-churn-probe.js" "$task_ext/mask-churn-probe@tests/extension.js"
printf '{"uuid":"mask-churn-probe@tests","name":"Mask churn probe","description":"Isolated performance test","shell-version":["50"]}\n' > "$task_ext/mask-churn-probe@tests/metadata.json"
task_schema="$task_ext/blur-my-shell@eturkes.com/schemas"
/usr/bin/gsettings set org.gnome.shell welcome-dialog-last-shown-version 999
/usr/bin/gsettings set org.gnome.shell enabled-extensions "['mask-churn-probe@tests']"
for task_key in blur enable-all static-blur blur-on-overview; do
    /usr/bin/gsettings --schemadir "$task_schema" set org.gnome.shell.extensions.blur-my-shell.applications "$task_key" true
done
/usr/bin/gsettings --schemadir "$task_schema" set org.gnome.shell.extensions.blur-my-shell.applications dynamic-opacity false
set +e
timeout 45 /usr/bin/dbus-run-session -- /usr/bin/gnome-shell --headless --wayland --no-x11 \
    --wayland-display=bms-mask-churn-test --virtual-monitor=1280x800 > "$task_root/shell.log" 2>&1
task_rc=$?
set -e
if ((task_rc)) || ! test -s "$BMS_MASK_TEST_RESULT"; then
    tail -n 50 "$task_root/shell.log" >&2
    printf 'Headless mask test failed: rc=%s\n' "$task_rc" >&2
    exit 1
fi
if rg -q '\[BMS window alpha mask\]|Clutter-CRITICAL|Cogl-CRITICAL' "$task_root/shell.log"; then
    rg '\[BMS window alpha mask\]|Clutter-CRITICAL|Cogl-CRITICAL' "$task_root/shell.log" >&2
    printf 'Headless mask test reported rendering errors.\n' >&2
    exit 1
fi
/usr/bin/gjs -c 'const GLib=imports.gi.GLib, System=imports.system;
const [, data]=GLib.file_get_contents(ARGV[0]);
const result=JSON.parse(new TextDecoder().decode(data)); print(JSON.stringify(result));
if (result.error || !result.blurVisible || !result.actorVisible || result.damages < 10 || result.captures < 10) {
    printerr("FAIL: test did not exercise the animated, visible static window mask"); System.exit(1);
}
let failed=false;
if (result.uniqueTextures > 8) {
    printerr("FAIL: static mask continually allocates new textures"); failed=true;
}
if (result.focused !== "Mask churn background" || result.visualDelta > 10) {
    printerr("FAIL: covered window leaks into the focused window"); failed=true;
}
if (!result.resized || !result.sizeMatches || !result.grown || !result.grownMatches || !result.cleaned || result.resizeSteps < 4) {
    printerr("FAIL: resize, mask geometry, or cleanup is incorrect"); failed=true;
}
if (result.resizeTextures > 8) {
    printerr("FAIL: resizing continually allocates new mask textures"); failed=true;
}
if (!result.focusHidesBlur || !result.unfocusedShowsBlur) {
    printerr("FAIL: focused and unfocused windows have incorrect blur visibility"); failed=true;
}
if (failed) System.exit(1);
print("PASS: animated static mask reuses textures and preserves window occlusion");' "$BMS_MASK_TEST_RESULT"
