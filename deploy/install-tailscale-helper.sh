#!/bin/sh
# Installs bounded permissions only. Does not change Tailscale state/preferences.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[ "$(id -u)" = 0 ] || { echo 'Run with sudo and the API service account.' >&2; exit 77; }
account=${1:-coreops}
case "$account" in ''|ALL|*[!a-zA-Z0-9_-]*|[0-9-]*) echo 'Invalid service account' >&2; exit 64 ;; esac
[ "$#" -le 1 ] || exit 64
getent passwd "$account" >/dev/null || exit 64
[ -x /usr/bin/python3 ] && [ -x /usr/sbin/visudo ] || exit 69
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -e /usr/local/libexec ]; then
 [ -d /usr/local/libexec ] && [ ! -L /usr/local/libexec ] && [ "$(stat -c %u /usr/local/libexec)" = 0 ] && [ "$((0$(stat -c %a /usr/local/libexec) & 0022))" -eq 0 ] || exit 77
else
 install -d -o root -g root -m 0755 /usr/local/libexec
fi
helper_tmp=$(mktemp /usr/local/libexec/.coreops-tailscale.XXXXXX)
rule_tmp=$(mktemp /etc/sudoers.d/.coreops-tailscale.XXXXXX)
trap 'rm -f "$helper_tmp" "$rule_tmp"' EXIT HUP INT TERM
install -o root -g root -m 0755 "$source_dir/coreops-tailscale" "$helper_tmp"
printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/coreops-tailscale check, /usr/local/libexec/coreops-tailscale apply\n' "$account" > "$rule_tmp"
chown root:root "$rule_tmp"
chmod 0440 "$rule_tmp"
/usr/sbin/visudo -cf "$rule_tmp"
mv -f "$helper_tmp" /usr/local/libexec/coreops-tailscale
mv -f "$rule_tmp" /etc/sudoers.d/coreops-tailscale
/usr/sbin/visudo -c
printf 'Restricted Tailscale helper installed for %s. No connection or preference was changed.\n' "$account"
