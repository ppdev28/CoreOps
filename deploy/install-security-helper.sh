#!/bin/sh
# Default: read-only evidence. Timer modification needs the explicit optional flag.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run as root, specifying the API service account.' >&2; exit 77; }
[ "$#" -ge 1 ] && [ "$#" -le 2 ] || exit 64
account=$1
case "$account" in ''|ALL|*[!a-zA-Z0-9_-]*|[0-9-]*) exit 64 ;; esac
getent passwd "$account" >/dev/null || exit 64
allow_timer=false
if [ "$#" = 2 ]; then [ "$2" = '--allow-auto-updates' ] || exit 64; allow_timer=true; fi
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -e /usr/local/libexec ]; then
 [ ! -L /usr/local/libexec ] && [ "$(stat -c %u /usr/local/libexec)" = 0 ] && [ -z "$(find /usr/local/libexec -maxdepth 0 -perm /022 -print)" ] || { echo 'Unsafe libexec directory' >&2; exit 77; }
else install -d -o root -g root -m 0755 /usr/local/libexec; fi
[ -x /usr/bin/python3 ] || exit 69
evidence_tmp=$(mktemp /usr/local/libexec/.coreops-security-evidence.XXXXXX)
helper_tmp=$(mktemp /usr/local/libexec/.coreops-security.XXXXXX)
rule_tmp=$(mktemp /etc/sudoers.d/.coreops-security.XXXXXX)
trap 'rm -f "$helper_tmp" "$rule_tmp" "$evidence_tmp"' EXIT HUP INT TERM
install -o root -g root -m 0755 "$source_dir/coreops-security" "$helper_tmp"
install -o root -g root -m 0755 "$source_dir/coreops-security-evidence" "$evidence_tmp"
printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/coreops-security ufw, /usr/local/libexec/coreops-security sshd, /usr/local/libexec/coreops-security fail2ban, /usr/local/libexec/coreops-security fail2ban-details, /usr/local/libexec/coreops-security sshd-context, /usr/local/libexec/coreops-security nft\n' "$account" > "$rule_tmp"
if "$allow_timer"; then printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/coreops-security enable-auto-updates\n' "$account" >> "$rule_tmp"; fi
chown root:root "$rule_tmp"
chmod 0440 "$rule_tmp"
/usr/sbin/visudo -cf "$rule_tmp"
mv -f "$evidence_tmp" /usr/local/libexec/coreops-security-evidence
mv -f "$helper_tmp" /usr/local/libexec/coreops-security
mv -f "$rule_tmp" /etc/sudoers.d/coreops-security
/usr/sbin/visudo -c
printf 'Installed restricted Security helper for %s (timer modification: %s). No services were changed.\n' "$account" "$allow_timer"
