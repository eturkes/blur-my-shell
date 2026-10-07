#!/usr/bin/env bash
set -euo pipefail

if (($# != 1)); then
    printf 'Usage: install-personal.sh EXTENSION_ARCHIVE\n' >&2
    exit 2
fi

# GNOME's installer moves an extracted directory from XDG_CACHE_HOME. That
# move cannot cross filesystems/subvolumes; stage next to the destination.
task_extension_root="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
mkdir -p "$task_extension_root"
task_install_cache=$(mktemp -d "$task_extension_root/.personal-install-XXXXXX")
trap 'rm -rf -- "$task_install_cache"' EXIT
XDG_CACHE_HOME="$task_install_cache" "${GNOME_EXTENSIONS:-/usr/bin/gnome-extensions}" install --force "$1"
