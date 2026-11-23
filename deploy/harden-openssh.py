#!/usr/bin/python3 -I
"""Manual root workflow with a five-minute rollback; never exposed through sudoers."""
import argparse
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess
import time

ROOT = Path("/var/lib/coreops/ssh-hardening")
DROPIN = Path("/etc/ssh/sshd_config.d/00-coreops-security.conf")
SSH_CONFIG = Path("/etc/ssh/sshd_config")
INSTALLED = Path("/usr/local/libexec/coreops-ssh-hardening")
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"}
POLICY = b"# CoreOps: public-key OpenSSH access; Tailscale SSH is separate.\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\nPubkeyAuthentication yes\nAuthenticationMethods publickey\n"
TOKEN = re.compile(r"[0-9]{14}-[0-9a-f]{12}\Z")

def run(*args, capture=False):
    result = subprocess.run(args, env=ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE if capture else None, check=True, timeout=30)
    return result.stdout.decode() if capture else ""

def safe_directory(path):
    if path.is_symlink():
        raise ValueError("Symlink directory is not allowed: " + str(path))
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    st = path.stat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022:
        raise ValueError("Unsafe root directory: " + str(path))

def check_user(name):
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]{0,31}", name):
        raise ValueError("Invalid Linux user")
    user = pwd.getpwnam(name)
    if user.pw_uid == 0:
        raise ValueError("Use the verified non-root administrator")
    for parent in (Path(user.pw_dir), Path(user.pw_dir) / ".ssh"):
        st = parent.stat()
        if parent.is_symlink() or st.st_uid not in (0, user.pw_uid) or st.st_mode & 0o022:
            raise ValueError("Unsafe SSH home or .ssh directory")
    keys = Path(user.pw_dir) / ".ssh" / "authorized_keys"
    if keys.is_symlink():
        raise ValueError("Review the authorized_keys symlink manually")
    st = keys.stat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid not in (0, user.pw_uid) or st.st_mode & 0o022 or st.st_size > 1024 * 1024:
        raise ValueError("Unsafe authorized_keys")
    if not re.search(rb"(?:^|\s)(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-[^ ]+|sk-ssh-ed25519@openssh.com|sk-ecdsa-sha2-[^ ]+)\s+[A-Za-z0-9+/=]+", keys.read_bytes()):
        raise ValueError("No supported authorized public key found")
    run("/usr/bin/ssh-keygen", "-l", "-f", str(keys), capture=True)
    # Presence is not proof of private-key possession. The caller must have
    # verified access from the intended client before invoking this root workflow.
    return user

def rollback(token):
    if not TOKEN.fullmatch(token):
        raise ValueError("Invalid rollback token")
    state = ROOT / token
    metadata = json.loads((state / "state.json").read_text())
    if DROPIN.is_symlink():
        raise ValueError("Unsafe SSH drop-in")
    if metadata["hadDropin"]:
        shutil.copyfile(state / "previous.conf", DROPIN)
        DROPIN.chmod(0o600)
    else:
        DROPIN.unlink(missing_ok=True)
    run("/usr/sbin/sshd", "-t")
    run("/usr/bin/systemctl", "reload", metadata["service"])
    (state / "rolled-back").touch(mode=0o600)
    print("Previous OpenSSH policy restored.")

def apply(name):
    check_user(name)
    for config in [SSH_CONFIG, *sorted(DROPIN.parent.glob("*.conf"))]:
        if config.exists() and re.search(r"(?im)^\s*Match\s+", config.read_text()):
            raise ValueError("Existing Match directives require contextual review; use Security's policy inspector before hardening manually")
    safe_directory(ROOT)
    safe_directory(DROPIN.parent)
    safe_directory(INSTALLED.parent)
    run("/usr/sbin/sshd", "-t")
    service = None
    for candidate in ("ssh.service", "sshd.service"):
        if run("/usr/bin/systemctl", "show", candidate, "--property=ActiveState", "--value", capture=True).strip() == "active":
            service = candidate
            break
    if service is None:
        raise ValueError("OpenSSH must already be active; this workflow does not enable it")
    if DROPIN.is_symlink():
        raise ValueError("Unsafe SSH drop-in")
    token = time.strftime("%Y%m%d%H%M%S", time.gmtime()) + "-" + os.urandom(6).hex()
    state = ROOT / token
    state.mkdir(mode=0o700)
    if DROPIN.exists():
        shutil.copyfile(DROPIN, state / "previous.conf")
        (state / "previous.conf").chmod(0o600)
    (state / "state.json").write_text(json.dumps({"hadDropin": DROPIN.exists(), "service": service, "user": name}))
    (state / "state.json").chmod(0o600)
    if Path(__file__).resolve() != INSTALLED.resolve():
        shutil.copyfile(__file__, INSTALLED)
        INSTALLED.chmod(0o755)
    temporary = DROPIN.with_name(".coreops-security.pending")
    temporary.write_bytes(POLICY)
    temporary.chmod(0o600)
    temporary.replace(DROPIN)
    try:
        run("/usr/sbin/sshd", "-t")
        text = run("/usr/sbin/sshd", "-T", "-C", "user=" + name + ",addr=127.0.0.1,host=localhost", capture=True)
        values = dict(line.split(" ", 1) for line in text.splitlines() if " " in line)
        if any(values.get(key) != value for key, value in {"passwordauthentication": "no", "kbdinteractiveauthentication": "no", "permitrootlogin": "no", "pubkeyauthentication": "yes", "authenticationmethods": "publickey"}.items()):
            raise ValueError("Other SSH directives override the profile; review them manually")
        run("/usr/bin/systemd-run", "--unit=coreops-ssh-rollback-" + token, "--on-active=5m", "/usr/bin/python3", "-I", str(INSTALLED), "rollback", token)
        run("/usr/bin/systemctl", "reload", service)
    except Exception:
        rollback(token)
        raise
    print("Profile loaded; existing sessions remain open. Automatic rollback in five minutes.")
    print("Verify a NEW public-key OpenSSH login as " + name + " from the intended client, then retain the policy:")
    print("sudo /usr/bin/python3 -I " + str(INSTALLED) + " keep " + token)
    print("Manual recovery: sudo /usr/bin/python3 -I " + str(INSTALLED) + " rollback " + token)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("apply", "rollback", "keep"))
    parser.add_argument("target", help="Linux user for apply; rollback token otherwise")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise PermissionError("Run with local sudo; no API sudo rule is installed")
    if args.action == "apply":
        apply(args.target)
    elif args.action == "rollback":
        rollback(args.target)
    else:
        if not TOKEN.fullmatch(args.target):
            raise ValueError("Invalid token")
        state = ROOT / args.target
        if (state / "rolled-back").exists():
            raise ValueError("Policy already rolled back; review current access")
        run("/usr/bin/systemctl", "stop", "coreops-ssh-rollback-" + args.target + ".timer")
        (state / "retained").touch(mode=0o600)
        print("Automatic rollback cancelled after administrator verification.")

if __name__ == "__main__":
    main()
