#!/usr/bin/python3 -I
"""Manual root activation of Linux Audit, Suricata, ClamAV and AIDE.

Installs signed distro packages, preserves configuration backups and existing
integrity databases. Does not modify SSH, firewall, Docker or Tailscale policy.
"""
import argparse
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import socket
import subprocess
import time

ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C", "DEBIAN_FRONTEND": "noninteractive", "NEEDRESTART_MODE": "l"}
ROOT = Path("/var/lib/coreops/security-protection")

def run(*args, timeout=300, capture=False):
    result = subprocess.run(args, env=ENV, stdin=subprocess.DEVNULL, check=True, timeout=timeout, stdout=subprocess.PIPE if capture else None)
    return result.stdout.decode() if capture else ""

def write(path, content):
    path = Path(path)
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError("Refusing configuration symlink: " + str(path))
    path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    if path.exists():
        backup = ROOT / "backups" / path.relative_to("/")
        backup.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if not backup.exists():
            shutil.copyfile(path, backup)
            backup.chmod(0o600)
    temporary = path.with_name("." + path.name + ".coreops-pending")
    if temporary.is_symlink():
        raise ValueError("Unsafe pending path")
    temporary.write_text(content)
    temporary.chmod(0o644)
    temporary.replace(path)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interface", help="Suricata interface; defaults to the single default-route interface")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise PermissionError("Run with local sudo; CoreOps receives no sensor-management sudo rule")
    available = next((int(line.split()[1]) * 1024 for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith("MemAvailable:")), 0)
    if available < 3 * 1024**3 or shutil.disk_usage("/").free < 3 * 1024**3:
        raise ValueError("The full sensor profile needs at least 3 GiB available RAM and disk; plan capacity or integrate remote sensors first")
    interface = args.interface
    if not interface:
        routes = json.loads(run("/usr/sbin/ip", "-j", "route", "show", "default", capture=True))
        choices = {r.get("dev") for r in routes if r.get("dev")}
        if len(choices) != 1:
            raise ValueError("Provide --interface explicitly when default routes are ambiguous")
        interface = choices.pop()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,15}", interface) or interface not in dict(socket.if_nameindex()).values():
        raise ValueError("Invalid IDS interface")
    if ROOT.is_symlink():
        raise ValueError("Unsafe state directory")
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    ROOT.chmod(0o700)
    if not (ROOT / "installed.json").exists() and not (ROOT / "intent.json").exists():
        state = run("/usr/bin/systemctl", "show", "suricata.service", "--property=ActiveState", "--value", capture=True).strip()
        if state == "active":
            raise ValueError("Existing Suricata is not managed by this profile; preserve and integrate it manually")
    (ROOT / "intent.json").write_text(json.dumps({"interface": interface}))
    (ROOT / "intent.json").chmod(0o600)
    print("Installing auditd, Suricata, ClamAV and AIDE. IDS interface: " + interface)
    run("/usr/bin/apt-get", "install", "-y", "auditd", "suricata", "clamav-daemon", "clamav-freshclam", "clamdscan", "aide", "python3-yaml", timeout=1800)
    import yaml  # Root-owned distro package installed above, with Python isolated mode.
    config_path = Path("/etc/suricata/suricata.yaml")
    config = yaml.safe_load(config_path.read_text())
    changed = False
    for output in config.get("outputs", []):
        if "eve-log" in output:
            output["eve-log"].update({"enabled": True, "filetype": "syslog", "identity": "suricata", "facility": "local5", "level": "Info", "types": ["alert", "anomaly", "stats"]})
            changed = True
    if not changed:
        raise ValueError("No EVE output in vendor configuration; review manually")
    write(config_path, "%YAML 1.1\n---\n" + yaml.safe_dump(config, sort_keys=False))
    write("/etc/systemd/system/suricata.service.d/coreops.conf", "[Service]\nType=simple\nExecStart=\nExecStart=/usr/bin/suricata -c /etc/suricata/suricata.yaml --af-packet=" + interface + " --pidfile /run/suricata.pid\nNice=10\nCPUQuota=100%\nMemoryMax=2G\n")
    run("/usr/bin/suricata-update", timeout=600)
    run("/usr/bin/suricata", "-T", "-c", str(config_path), "--af-packet=" + interface, timeout=120)
    clam_config = Path("/etc/clamav/clamd.conf").read_text()
    if re.search(r"(?m)^LogSyslog\s", clam_config):
        clam_config = re.sub(r"(?m)^LogSyslog\s+.*$", "LogSyslog true", clam_config)
    else:
        clam_config += "\nLogSyslog true\n"
    write("/etc/clamav/clamd.conf", clam_config)
    write("/etc/systemd/system/clamav-daemon.service.d/coreops.conf", "[Service]\nNice=10\nCPUQuota=100%\nMemoryMax=2G\n")
    write("/etc/systemd/system/coreops-malware.service", "[Unit]\nDescription=CoreOps scheduled malware evidence\nAfter=clamav-daemon.service\nRequires=clamav-daemon.service\n[Service]\nType=oneshot\nNice=19\nCPUQuota=25%\nIOWeight=10\nTimeoutStartSec=2h\nExecStart=/usr/bin/clamdscan --fdpass --multiscan --infected /srv /opt /var/tmp /tmp\nStandardOutput=journal\nStandardError=journal\nSyslogIdentifier=coreops-malware\n")
    write("/etc/systemd/system/coreops-malware.timer", "[Unit]\nDescription=Daily CoreOps malware scan\n[Timer]\nOnCalendar=*-*-* 03:35:00\nRandomizedDelaySec=20m\nPersistent=true\n[Install]\nWantedBy=timers.target\n")
    # Build a baseline only when none exists. Never accept existing changes by
    # overwriting a known database; initial trust must be assessed by the admin.
    databases = [p for p in (Path("/var/lib/aide/aide.db"), Path("/var/lib/aide/aide.db.gz")) if p.is_file()]
    if not databases:
        if list(Path("/var/lib/aide").glob("aide.db.new*")):
            raise ValueError("An unreviewed new AIDE database exists; preserve and review it before activation")
        run("/usr/bin/nice", "-n", "19", "/usr/sbin/aideinit", "--yes", "--force", timeout=1800)
    if not Path("/var/lib/aide/aide.conf.autogenerated").is_file():
        raise ValueError("Vendor AIDE configuration was not generated; review aideinit before scheduling checks")
    write("/etc/systemd/system/coreops-aide.service", "[Unit]\nDescription=CoreOps file integrity evidence\n[Service]\nType=oneshot\nNice=19\nCPUQuota=25%\nIOWeight=10\nTimeoutStartSec=2h\nExecStart=/usr/bin/aide --config=/var/lib/aide/aide.conf.autogenerated --check\nStandardOutput=journal\nStandardError=journal\nSyslogIdentifier=coreops-aide\n")
    write("/etc/systemd/system/coreops-aide.timer", "[Unit]\nDescription=Daily CoreOps file integrity check\n[Timer]\nOnCalendar=*-*-* 03:05:00\nRandomizedDelaySec=20m\nPersistent=true\n[Install]\nWantedBy=timers.target\n")
    run("/usr/bin/systemctl", "daemon-reload")
    run("/usr/bin/systemctl", "enable", "--now", "clamav-freshclam.service")
    deadline = time.monotonic() + 180
    while not any(Path("/var/lib/clamav").glob("daily.c[lv]d")) and time.monotonic() < deadline:
        time.sleep(2)
    if not any(Path("/var/lib/clamav").glob("daily.c[lv]d")):
        raise ValueError("ClamAV definitions are not available yet; inspect freshclam and retry this profile")
    run("/usr/bin/systemctl", "enable", "--now", "auditd.service", "clamav-daemon.service", "coreops-aide.timer", "coreops-malware.timer")
    run("/usr/bin/systemctl", "restart", "suricata.service")
    run("/usr/bin/systemctl", "enable", "suricata.service")
    (ROOT / "installed.json").write_text(json.dumps({"interface": interface, "configuredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "scanPaths": ["/srv", "/opt", "/var/tmp", "/tmp"]}))
    (ROOT / "installed.json").chmod(0o600)
    print("Sensor services configured. Verify signatures, rule traffic, interface and initial integrity baseline in Security; service startup alone is not proof of coverage.")
    print("Configuration backups: " + str(ROOT / "backups"))

if __name__ == "__main__":
    main()
