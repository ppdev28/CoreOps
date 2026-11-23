#!/usr/bin/env python3
"""Real signed APT test in private directories. No host APT configuration changes."""
import argparse
import functools
import hashlib
import http.server
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import tempfile
import threading

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('packages', nargs='+', type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='coreops-signed-apt-test-') as temp:
        work = Path(temp); home = work / 'gpg'; home.mkdir(mode=0o700)
        env = dict(os.environ, GNUPGHOME=str(home))
        server = None
        try:
            subprocess.run(['gpg', '--batch', '--pinentry-mode', 'loopback', '--passphrase', '',
                '--quick-gen-key', 'CoreOps disposable validation <validation@invalid.test>', 'ed25519', 'sign', '1d'], env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            keys = subprocess.check_output(['gpg', '--batch', '--with-colons', '--list-keys'], env=env, text=True)
            fingerprint = next(line.split(':')[9] for line in keys.splitlines() if line.startswith('fpr:'))
            repo = work / 'repo'
            subprocess.run(['python3', str(ROOT / 'scripts/build-apt-repository.py'),
                *[str(p.resolve()) for p in args.packages], '--output', str(repo), '--sign-key', fingerprint], env=env, check=True)
            release = (repo / 'dists/stable/Release').read_bytes()
            assert b'Valid-Until:' in release and b'Acquire-By-Hash: yes' in release
            subprocess.run(['gpg', '--batch', '--verify', str(repo / 'dists/stable/InRelease')], env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            class Quiet(http.server.SimpleHTTPRequestHandler):
                def log_message(self, *args): pass
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(repo)))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            lists = work / 'lists'; lists.mkdir(); (lists / 'partial').mkdir()
            cache = work / 'cache'; cache.mkdir(); (cache / 'archives').mkdir(); (cache / 'archives/partial').mkdir()
            status = work / 'status'; shutil.copyfile('/var/lib/dpkg/status', status)
            empty = work / 'empty'; empty.mkdir()
            sources = work / 'coreops.sources'
            sources.write_text(f'Types: deb\nURIs: http://127.0.0.1:{server.server_port}\nSuites: stable\nComponents: main\nSigned-By: {repo}/coreops-archive-keyring.asc\n')
            config = work / 'apt.conf'
            config.write_text(f'''Dir::Etc::main "/dev/null";
Dir::Etc::parts "{empty}";
Dir::Etc::sourcelist "{sources}";
Dir::Etc::sourceparts "{empty}";
Dir::State::lists "{lists}";
Dir::State::status "{status}";
Dir::Cache "{cache}";
APT::Sandbox::User "{pwd.getpwuid(os.getuid()).pw_name}";
Acquire::Languages "none";
Acquire::http::Proxy "DIRECT";
APT::Update::Error-Mode "any";
''')
            apt_env = dict(os.environ, APT_CONFIG=str(config))
            subprocess.run(['apt-get', 'update'], env=apt_env, cwd=work, check=True)
            policy = subprocess.check_output(['apt-cache', 'policy', 'coreops'], env=apt_env, cwd=work, text=True)
            assert 'Candidate: (none)' not in policy and 'Candidate:' in policy, policy
            subprocess.run(['apt-get', '--simulate', 'install', '--no-install-recommends', 'coreops'], env=apt_env, cwd=work, check=True)
            subprocess.run(['apt-get', 'download', 'coreops'], env=apt_env, cwd=work, check=True)
            downloaded = next(work.glob('coreops_*.deb'))
            expected = {hashlib.sha256(p.read_bytes()).hexdigest() for p in args.packages}
            assert hashlib.sha256(downloaded.read_bytes()).hexdigest() in expected
            signed = repo / 'dists/stable/InRelease'
            original = signed.read_bytes()
            tampered = original.replace(b'Origin: CoreOps', b'Origin: Corrupt')
            assert tampered != original
            signed.write_bytes(tampered)
            # Force a fetch instead of a same-second HTTP 304/cached signature.
            for entry in lists.iterdir():
                if entry.is_file() and entry.name.endswith('InRelease'): entry.unlink()
            bad = subprocess.run(['apt-get', 'update'], env=apt_env, cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            assert bad.returncode != 0, 'Tampered signature was accepted'
            print('PASS: signed update, candidate, simulated install, exact download hash and tamper rejection; no host APT writes.')
        finally:
            if server: server.shutdown(); server.server_close()
            subprocess.run(['gpgconf', '--homedir', str(home), '--kill', 'gpg-agent'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__': main()
