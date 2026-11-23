#!/usr/bin/env python3
"""Inspect a built package without installing it or running maintainer scripts."""
import argparse
import io
import json
from pathlib import Path
import stat
import subprocess
import tarfile
import tempfile


def verify(package):
    fields = subprocess.check_output(['dpkg-deb', '-f', str(package), 'Package', 'Version', 'Architecture'], text=True)
    metadata = dict(line.split(': ', 1) for line in fields.splitlines())
    assert metadata['Package'] == 'coreops'
    raw = subprocess.check_output(['dpkg-deb', '--fsys-tarfile', str(package)])
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        members = {entry.name.removeprefix('./'): entry for entry in archive.getmembers()}
        for name, entry in members.items():
            assert entry.uid == entry.gid == 0, 'Non-root package owner'
            assert not entry.mode & 0o022, 'Writable package artifact: ' + name
            assert entry.isdir() or entry.isfile(), 'Unexpected special file: ' + name
            assert not name.startswith(('home/', 'usr/local/', 'var/lib/coreops/')), 'Local state in package'
            assert not name.endswith(('.env.local', '.map', '/users.json', '/sessions.json', '/terminal-passwords.key')), 'Secret/dev output in package'
        assert members['etc/coreops/coreops.env'].mode == 0o600
        assert members['usr/bin/coreops-api'].mode == 0o755
        assert members['usr/sbin/coreops-setup'].mode == 0o755
        assert members['usr/libexec/coreops/coreops-services'].mode == 0o755
        assert 'usr/share/coreops/web/index.html' in members
        assert 'usr/lib/systemd/system/coreops.service' in members
        assert b'/usr/local/libexec' not in archive.extractfile(members['usr/libexec/coreops/coreops-security']).read()
    with tempfile.TemporaryDirectory(prefix='coreops-control-check-') as temp:
        subprocess.run(['dpkg-deb', '-e', str(package), temp], check=True)
        for name in ('postinst', 'prerm', 'postrm'):
            file = Path(temp) / name
            assert stat.S_IMODE(file.stat().st_mode) == 0o755
            subprocess.run(['/bin/sh', '-n', str(file)], check=True)
        assert (Path(temp) / 'conffiles').read_text() == '/etc/coreops/coreops.env\n'
    print(json.dumps(dict(metadata, verified=True), indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    verify(parser.parse_args().package.resolve())
