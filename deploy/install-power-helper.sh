#!/bin/sh
# Review before running as root. This does not execute any power action.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run with sudo and the API service account.' >&2; exit 77; }
account=${1:-coreops}
case "$account" in ''|*[!a-zA-Z0-9_-]*|[0-9-]*) echo 'Invalid service account' >&2; exit 64 ;; esac
getent passwd "$account" >/dev/null || exit 64
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ -x /usr/sbin/visudo ] || exit 69
if [ -e /usr/local/libexec ]; then
    [ -d /usr/local/libexec ] && [ ! -L /usr/local/libexec ] && [ "$(stat -c %u /usr/local/libexec)" = 0 ] && [ "$((0$(stat -c %a /usr/local/libexec) & 0022))" -eq 0 ] || exit 77
else
    install -d -o root -g root -m 0755 /usr/local/libexec
fi
helper_tmp=$(mktemp /usr/local/libexec/.coreops-power.XXXXXX)
rule_tmp=$(mktemp /etc/sudoers.d/.coreops-power.XXXXXX)
trap 'rm -f "$helper_tmp" "$rule_tmp"' EXIT HUP INT TERM
install -o root -g root -m 0755 "$source_dir/coreops-power" "$helper_tmp"
printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/coreops-power status, /usr/local/libexec/coreops-power poweroff, /usr/local/libexec/coreops-power reboot, /usr/local/libexec/coreops-power suspend\n' "$account" > "$rule_tmp"
chown root:root "$rule_tmp"
chmod 0440 "$rule_tmp"
/usr/sbin/visudo -cf "$rule_tmp"
mv -f "$helper_tmp" /usr/local/libexec/coreops-power
mv -f "$rule_tmp" /etc/sudoers.d/coreops-power
/usr/sbin/visudo -c
printf 'Installed restricted power helper for %s. No shutdown, suspend or restart was requested.\n' "$account"
