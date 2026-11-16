#!/bin/sh
# Run as root AFTER reviewing this file and coreops-packages.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run with sudo, specifying the API service user.' >&2; exit 77; }
account=${1:-coreops}
case "$account" in ''|*[!a-zA-Z0-9_-]*|[0-9-]*) echo 'Invalid service account' >&2; exit 64 ;; esac
getent passwd "$account" >/dev/null || { echo 'Service account does not exist' >&2; exit 64; }
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ -x /usr/sbin/visudo ] || { echo 'sudo/visudo is required' >&2; exit 69; }
# These are the only installed artifacts; no generic sudo or apt grant.
if [ -e /usr/local/libexec ]; then
  [ -d /usr/local/libexec ] && [ ! -L /usr/local/libexec ] && [ "$(stat -c %u /usr/local/libexec)" = 0 ] && [ "$((0$(stat -c %a /usr/local/libexec) & 0022))" -eq 0 ] || { echo 'Existing libexec directory is unsafe; review its ownership/permissions first.' >&2; exit 77; }
else
  install -d -o root -g root -m 0755 /usr/local/libexec
fi
helper_tmp=$(mktemp /usr/local/libexec/.coreops-packages.XXXXXX)
rule_tmp=$(mktemp /etc/sudoers.d/.coreops-updates.XXXXXX)
trap 'rm -f "$helper_tmp" "$rule_tmp"' EXIT HUP INT TERM
install -o root -g root -m 0755 "$source_dir/coreops-packages" "$helper_tmp"
printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/coreops-packages\n' "$account" > "$rule_tmp"
chown root:root "$rule_tmp"
chmod 0440 "$rule_tmp"
/usr/sbin/visudo -cf "$rule_tmp"
mv -f "$helper_tmp" /usr/local/libexec/coreops-packages
mv -f "$rule_tmp" /etc/sudoers.d/coreops-updates
/usr/sbin/visudo -c
printf 'Installed restricted APT helper for %s. No packages were updated.\n' "$account"
