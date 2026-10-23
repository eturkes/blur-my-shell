#!/usr/bin/env bash
set -euo pipefail

task_repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
task_bms=${1:-"$task_repo/build/source"}
task_extensions=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions
task_dtp=${2:-"$task_extensions/dash-to-panel@eturkes.com"}
task_luminus=${3:-"$task_extensions/luminus-desktop@eturkes.com"}
for task_dir in "$task_bms" "$task_dtp" "$task_luminus"; do
    test -f "$task_dir/metadata.json" || { printf 'Missing extension: %s\n' "$task_dir" >&2; exit 2; }
done
task_root=$(mktemp -d "$task_repo/build/panel-rebase.XXXXXX")
cleanup() {
    local result=$?
    # Session services can finish their final writes just after the bus exits.
    for attempt in 1 2 3; do
        if rm -rf -- "$task_root"; then return "$result"; fi
        sleep 0.1
    done
    return 1
}
trap cleanup EXIT
export XDG_CONFIG_HOME="$task_root/config" XDG_CACHE_HOME="$task_root/cache"
export XDG_DATA_HOME="$task_root/data" XDG_STATE_HOME="$task_root/state"
export XDG_RUNTIME_DIR="$task_root/runtime" GSETTINGS_BACKEND=keyfile
export PANEL_REBASE_RESULT="$task_root/result.json"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
task_staged="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p "$task_staged"
cp -a "$task_bms" "$task_staged/blur-my-shell@eturkes.com"
cp -a "$task_dtp" "$task_staged/dash-to-panel@eturkes.com"
cp -a "$task_luminus" "$task_staged/luminus-desktop@eturkes.com"
for task_uuid in panel-rebase-target@tests panel-rebase-probe@tests; do
    mkdir -p "$task_staged/$task_uuid"
    printf '{"uuid":"%s","name":"Panel rebase test","description":"Isolated lifecycle check","shell-version":["50"]}\n' \
        "$task_uuid" > "$task_staged/$task_uuid/metadata.json"
done
printf 'export default class Target { enable() {} disable() {} }\n' > "$task_staged/panel-rebase-target@tests/extension.js"
cp "$task_repo/tests/panel-rebase.js" "$task_staged/panel-rebase-probe@tests/extension.js"
export GSETTINGS_SCHEMA_DIR="$task_staged/blur-my-shell@eturkes.com/schemas"
/usr/bin/gsettings set org.gnome.desktop.interface enable-animations false
/usr/bin/gsettings set org.gnome.desktop.interface color-scheme prefer-light
/usr/bin/gsettings set org.gnome.shell welcome-dialog-last-shown-version 999
/usr/bin/gsettings set org.gnome.shell disable-extension-version-validation true
/usr/bin/gsettings set org.gnome.shell enabled-extensions "['panel-rebase-probe@tests']"
/usr/bin/gsettings set org.gnome.shell.extensions.blur-my-shell.panel force-light-text true
/usr/bin/gsettings set org.gnome.shell.extensions.blur-my-shell.panel blur true
/usr/bin/gsettings set org.gnome.shell.extensions.blur-my-shell.panel override-background false
set +e
timeout 45 /usr/bin/dbus-run-session -- /usr/bin/gnome-shell --headless --wayland --no-x11 \
    --virtual-monitor 1280x720 > "$task_root/shell.log" 2>&1
task_rc=$?
set -e
if ((task_rc)) || ! test -s "$PANEL_REBASE_RESULT"; then
    tail -n 55 "$task_root/shell.log" >&2
    printf 'Headless Shell failed: rc=%s\n' "$task_rc" >&2
    exit 1
fi
set +e
/usr/bin/gjs -c 'const GLib = imports.gi.GLib; const [, data] = GLib.file_get_contents(ARGV[0]);
const result = JSON.parse(new TextDecoder().decode(data)); print(JSON.stringify(result));
if (result.error) imports.system.exit(1);' "$PANEL_REBASE_RESULT"
task_rc=$?
set -e
if ((task_rc)); then tail -n 35 "$task_root/shell.log" >&2; fi
exit "$task_rc"
