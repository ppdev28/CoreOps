#!/usr/bin/env python3
"""Generate a signed APT repository locally; never upload it or create signing keys."""
import argparse
import datetime
import gzip
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def build(packages, output, key, previous=None):
    if not re.fullmatch(r'[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64}', key): raise ValueError('Use a full signing key fingerprint')
    if output.exists(): raise ValueError('Use a new output directory; deploy completed generations atomically')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.coreops-apt-', dir=output.parent) as work:
        stage = Path(work) / 'repo'; stage.mkdir()
        pool = stage / 'pool/main/c/coreops'; pool.mkdir(parents=True)
        if previous:
            for source in (previous / 'pool').rglob('*.deb'):
                if source.is_symlink(): raise ValueError('Symlink in previous repository')
                shutil.copyfile(source, pool / source.name)
        architectures = set()
        for package in packages:
            fields = subprocess.check_output(['dpkg-deb', '-f', str(package), 'Package', 'Version', 'Architecture'], text=True)
            values = dict(line.split(': ', 1) for line in fields.splitlines())
            if values['Package'] != 'coreops' or values['Architecture'] not in ('amd64', 'arm64'):
                raise ValueError('Only amd64/arm64 CoreOps packages are accepted')
            version = values['Version']; arch = values['Architecture']
            if not re.fullmatch(r'[0-9][A-Za-z0-9.+~\-]*', version): raise ValueError('Invalid version')
            target = pool / f'coreops_{version}_{arch}.deb'
            if target.exists() and hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(package.read_bytes()).digest():
                raise ValueError('Refusing to replace immutable package/version')
            shutil.copyfile(package, target)
        for package in pool.glob('*.deb'):
            arch = subprocess.check_output(['dpkg-deb', '-f', str(package), 'Architecture'], text=True).strip()
            if arch not in ('amd64', 'arm64'): raise ValueError('Unexpected previous architecture')
            architectures.add(arch)
        if not architectures: raise ValueError('No packages')
        distribution = stage / 'dists/stable'
        for arch in sorted(architectures):
            index = distribution / f'main/binary-{arch}'; index.mkdir(parents=True)
            data = subprocess.check_output(['dpkg-scanpackages', '--multiversion', '-a', arch, 'pool', '/dev/null'], cwd=stage)
            (index / 'Packages').write_bytes(data)
            (index / 'Packages.gz').write_bytes(gzip.compress(data, mtime=0))
            for name in ('Packages', 'Packages.gz'):
                content = (index / name).read_bytes()
                for algorithm in ('sha256', 'sha512'):
                    by_hash = index / 'by-hash' / algorithm.upper(); by_hash.mkdir(parents=True, exist_ok=True)
                    (by_hash / hashlib.new(algorithm, content).hexdigest()).write_bytes(content)
            if previous:
                for algorithm, length in (('SHA256', 64), ('SHA512', 128)):
                    previous_hashes = previous / f'dists/stable/main/binary-{arch}/by-hash/{algorithm}'
                    if previous_hashes.is_dir():
                        for old_hash in previous_hashes.iterdir():
                            if old_hash.is_symlink() or not re.fullmatch(r'[a-f0-9]{' + str(length) + '}', old_hash.name):
                                raise ValueError('Unsafe previous index hash')
                            shutil.copyfile(old_hash, index / 'by-hash' / algorithm / old_hash.name)
        expiry = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=14)).strftime('%a, %d %b %Y %H:%M:%S +0000')
        options = {'Origin': 'CoreOps', 'Label': 'CoreOps', 'Suite': 'stable', 'Codename': 'stable',
                   'Architectures': ' '.join(sorted(architectures)), 'Components': 'main',
                   'Description': 'CoreOps signed package repository', 'Acquire-By-Hash': 'yes'}
        cmd = ['apt-ftparchive']
        for name, value in options.items(): cmd += ['-o', f'APT::FTPArchive::Release::{name}={value}']
        release = subprocess.check_output(cmd + ['release', 'dists/stable'], cwd=stage)
        # Some apt-ftparchive versions ignore the documented Valid-Until option.
        # Add the bounded validity explicitly before signing the complete file.
        release = ('Valid-Until: ' + expiry + '\n').encode() + release
        (distribution / 'Release').write_bytes(release)
        for arguments in [ ['--clearsign', '--output', str(distribution / 'InRelease')],
                           ['--armor', '--detach-sign', '--output', str(distribution / 'Release.gpg')]]:
            subprocess.run(['gpg', '--batch', '--yes', '--local-user', key, '--digest-algo', 'SHA256',
                            *arguments, str(distribution / 'Release')], check=True)
        public = subprocess.check_output(['gpg', '--batch', '--export-options', 'export-minimal', '--armor', '--export', key])
        if not public: raise ValueError('No public key exported')
        (stage / 'coreops-archive-keyring.asc').write_bytes(public)
        for path in stage.rglob('*'):
            path.chmod(0o755 if path.is_dir() else 0o644)
        os.rename(stage, output)
    print(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('packages', nargs='+', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--sign-key', required=True, help='Existing full GPG signing fingerprint; use a protected signing key')
    parser.add_argument('--previous', type=Path, help='Retain immutable packages from the previous repository generation')
    args = parser.parse_args()
    build([p.resolve() for p in args.packages], args.output.resolve(), args.sign_key, args.previous)


if __name__ == '__main__': main()
