#!/usr/bin/env python3
"""Build/install CoreOps and configure systemd with one interactive sudo session."""
import argparse
import datetime
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, help='Install an already built local .deb')
    parser.add_argument('--version', help='Debian version for a local build')
    parser.add_argument('--migrate-running', action='store_true', help='Stop/import the sole API owned by this user')
    permissions = parser.add_mutually_exclusive_group()
    permissions.add_argument('--enable', help='Replace explicit capabilities; see coreops-setup --help')
    permissions.add_argument('--add', help='Add capabilities without removing existing permissions')
    parser.add_argument('--bind', help='Explicit private IP, otherwise loopback/preserved')
    parser.add_argument('--port', type=int)
    parser.add_argument('--admin', help='First administrator when no identity is imported')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if os.geteuid() == 0: parser.error('Run as your normal user; sudo is requested only for installation')
    setup = []
    if args.migrate_running:
        if Path('/etc/coreops/configured').exists(): parser.error('The service is already configured; do not import another identity over it')
        pids = []
        for proc in Path('/proc').iterdir():
            try:
                if proc.name.isdecimal() and proc.stat().st_uid == os.getuid() and (proc / 'comm').read_text().strip() == 'coreops-api':
                    pids.append(proc.name)
            except (OSError, ValueError): pass
        if len(pids) != 1: parser.error('Expected exactly one running CoreOps API owned by you; use coreops-setup --migrate-pid explicitly')
        setup += ['--migrate-pid', pids[0]]
    for name in ('enable', 'add', 'bind', 'port', 'admin'):
        if getattr(args, name) is not None: setup += ['--' + name, str(getattr(args, name))]
    if args.dry_run:
        subprocess.run([sys.executable, '-I', str(ROOT / 'deploy/coreops-setup'), '--dry-run', *setup], check=True)
        return
    if not args.migrate_running and not args.admin and not Path('/etc/coreops/configured').exists():
        parser.error('Choose --migrate-running or --admin NAME for the initial identity')
    package = args.package.resolve() if args.package else None
    if package is None:
        version = args.version or ('0.1.0~dev' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S'))
        subprocess.run([sys.executable, str(ROOT / 'scripts/build-deb.py'), '--version', version], check=True)
        arch = subprocess.check_output(['dpkg', '--print-architecture'], text=True).strip()
        package = ROOT / 'dist/packages' / f'coreops_{version}_{arch}.deb'
    if not package.is_file(): parser.error('Local package does not exist')
    name = subprocess.check_output(['dpkg-deb', '-f', str(package), 'Package'], text=True).strip()
    if name != 'coreops': parser.error('Expected the coreops package')
    print('Installing the local package; service restart/migration closes active CoreOps terminals.', flush=True)
    subprocess.run(['sudo', 'apt-get', 'install', '--no-install-recommends', '-y', str(package)], check=True)
    subprocess.run(['sudo', '/usr/sbin/coreops-setup', *setup], check=True)


if __name__ == '__main__': main()
