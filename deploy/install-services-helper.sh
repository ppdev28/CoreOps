#!/bin/sh
# Source installations only. Packaged services use coreops-setup --add services.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run with sudo and the API account.' >&2; exit 77; }
[ "$#" = 1 ] || exit 64
account=$1
case "$account" in ''|ALL|*[!a-zA-Z0-9_-]*|[0-9-]*) exit 64 ;; esac
getent passwd "$account" >/dev/null || exit 64
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ -x /usr/sbin/visudo ] && [ -x /usr/bin/python3 ] || exit 69
if [ -e /usr/local/libexec ]; then
    [ -d /usr/local/libexec ] && [ ! -L /usr/local/libexec ] && [ "$(stat -c %u /usr/local/libexec)" = 0 ] && [ "$((0$(stat -c %a /usr/local/libexec) & 0022))" -eq 0 ] || exit 77
else
    install -d -o root -g root -m 0755 /usr/local/libexec
fi
helper_tmp=$(mktemp /usr/local/libexec/.coreops-services.XXXXXX)
rule_tmp=$(mktemp /etc/sudoers.d/.coreops-services.XXXXXX)
trap 'rm -f "$helper_tmp" "$rule_tmp"' EXIT HUP INT TERM
install -o root -g root -m 0755 "$source_dir/coreops-services" "$helper_tmp"
printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/coreops-services check, /usr/local/libexec/coreops-services apply\n' "$account" > "$rule_tmp"
chown root:root "$rule_tmp"; chmod 0440 "$rule_tmp"
/usr/sbin/visudo -cf "$rule_tmp"
mv -f "$helper_tmp" /usr/local/libexec/coreops-services
mv -f "$rule_tmp" /etc/sudoers.d/coreops-services
/usr/sbin/visudo -c
echo 'Restricted Services helper installed. No service was started/stopped/restarted.'
