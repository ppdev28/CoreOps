#!/usr/bin/env python3
"""Enroll a CoreOps HTTPS APT repository using an independently verified key fingerprint."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request


def fetch_key(url):
    class HTTPSOnly(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, message, headers, new_url):
            if urllib.parse.urlsplit(new_url).scheme != 'https':
                raise ValueError('Refusing non-HTTPS redirect')
            return super().redirect_request(request, fp, code, message, headers, new_url)
    with urllib.request.build_opener(HTTPSOnly()).open(url, timeout=20) as response:
        content = response.read(65537)
    if len(content) > 65536: raise ValueError('Key file exceeds limit')
    return content


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='HTTPS base URL of the published repository')
    parser.add_argument('--fingerprint', required=True, help='Full primary fingerprint verified out of band')
    args = parser.parse_args()
    url = urllib.parse.urlsplit(args.url)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or any(c.isspace() for c in args.url):
        parser.error('Use a plain HTTPS repository base URL')
    fingerprint = args.fingerprint.upper()
    if not re.fullmatch(r'[A-F0-9]{40}|[A-F0-9]{64}', fingerprint): parser.error('Full key fingerprint required')
    if os.geteuid() != 0: parser.error('Run with sudo')
    if shutil.which('gpg') is None:
        subprocess.run(['apt-get', 'update', '-o', 'APT::Update::Error-Mode=any'], check=True)
        subprocess.run(['apt-get', 'install', '--no-install-recommends', '-y', 'gnupg', 'ca-certificates'], check=True)
    base = args.url.rstrip('/')
    key = fetch_key(base + '/coreops-archive-keyring.asc')
    with tempfile.TemporaryDirectory(prefix='coreops-key-') as temp:
        file = Path(temp) / 'key.asc'; file.write_bytes(key)
        details = subprocess.check_output(['gpg', '--homedir', temp, '--batch', '--with-colons', '--show-keys', str(file)], text=True)
        primary = []
        want_primary = False
        for line in details.splitlines():
            fields = line.split(':')
            if fields[0] == 'pub': want_primary = True
            elif fields[0] == 'sub': want_primary = False
            elif fields[0] == 'fpr' and want_primary:
                primary.append(fields[9]); want_primary = False
        if primary != [fingerprint]: parser.error('Downloaded key does not match the trusted primary fingerprint')
    keyring = Path('/etc/apt/keyrings'); keyring.mkdir(mode=0o755, exist_ok=True)
    if keyring.is_symlink(): parser.error('Unsafe keyring directory')
    target = keyring / 'coreops.asc'
    source = Path('/etc/apt/sources.list.d/coreops.sources')
    pin = Path('/etc/apt/preferences.d/coreops')
    values = {
        target: key,
        source: f'Types: deb\nURIs: {base}\nSuites: stable\nComponents: main\nSigned-By: {target}\n'.encode(),
        # Repository trust is scoped to CoreOps, never higher-priority system packages.
        pin: b'Package: coreops\nPin: release o=CoreOps\nPin-Priority: 500\n\nPackage: *\nPin: release o=CoreOps\nPin-Priority: -1\n',
    }
    for path, content in values.items():
        if path.is_symlink(): parser.error('Refusing symlink ' + str(path))
        if path.exists() and path.read_bytes() != content: parser.error('Existing APT configuration differs; review ' + str(path))
    for path, content in values.items():
        fd, name = tempfile.mkstemp(prefix='.coreops-', dir=path.parent)
        with os.fdopen(fd, 'wb') as file:
            os.fchmod(file.fileno(), 0o644); file.write(content); file.flush(); os.fsync(file.fileno())
        os.replace(name, path)
    subprocess.run(['apt-get', 'update', '-o', 'APT::Update::Error-Mode=any'], check=True)
    subprocess.run(['apt-get', 'install', '--no-install-recommends', '-y', 'coreops'], check=True)
    print('Repository configured and coreops installed. Run sudo coreops-setup --admin NAME or import existing identity.')


if __name__ == '__main__': main()
