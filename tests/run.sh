#!/usr/bin/env bash
set -euo pipefail

task_tests_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
task_gjs=${GJS:-/usr/bin/gjs}
if [[ ! -x "$task_gjs" ]]; then
    printf 'Native GJS not found: %s (set GJS to its executable path).\n' "$task_gjs" >&2
    exit 2
fi

# Shell/Mutter keep private typelibs and libraries outside the usual GI paths.
# Cover lib, lib64 and Debian multiarch layouts without pinning a Shell version.
task_gi_dirs=()
for task_dir in /usr/lib/gnome-shell /usr/lib64/gnome-shell \
    /usr/lib/mutter-* /usr/lib64/mutter-* \
    /usr/lib/*-linux-gnu/gnome-shell /usr/lib/*-linux-gnu/mutter-*; do
    [[ -d "$task_dir" ]] && task_gi_dirs+=("$task_dir")
done
if ((${#task_gi_dirs[@]})); then
    task_private_path=$(IFS=:; printf '%s' "${task_gi_dirs[*]}")
    export GI_TYPELIB_PATH="$task_private_path${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
    export LD_LIBRARY_PATH="$task_private_path${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

exec "$task_gjs" -m "$task_tests_dir/regressions.js" "$@"
