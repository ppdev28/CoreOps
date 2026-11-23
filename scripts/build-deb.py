#!/usr/bin/env python3
"""Build a private/release CoreOps .deb without root or runtime secrets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
HELPERS = ('coreops-power', 'coreops-security', 'coreops-security-evidence',
           'coreops-tailscale', 'coreops-packages', 'coreops-services')


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def build(version, architecture, output, frontend_built=False):
    if not re.fullmatch(r'[0-9][A-Za-z0-9.+~\-]*', version):
        raise ValueError('Invalid Debian version')
    run(['dpkg', '--validate-version', version])
    if architecture not in ('amd64', 'arm64'):
        raise ValueError('Supported architectures: amd64, arm64')
    output.mkdir(parents=True, exist_ok=True)
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT))
    epoch = os.environ.get('SOURCE_DATE_EPOCH') or subprocess.check_output(
        ['git', 'show', '-s', '--format=%ct', 'HEAD'], cwd=ROOT, text=True).strip()
    if not frontend_built:
        run(['pnpm', 'install', '--frozen-lockfile'], cwd=ROOT / 'frontend')
        env = {k: v for k, v in os.environ.items() if not k.startswith('VITE_')}
        env['VITE_API_BASE_URL'] = '/api/v1'
        run(['pnpm', 'exec', 'tsc', '-b'], cwd=ROOT / 'frontend', env=env)
        with tempfile.TemporaryDirectory(prefix='coreops-vite-env-') as empty_env:
            run(['node', '--input-type=module', '-e',
                 "import {build} from 'vite'; await build({envDir:process.argv[1],base:'/'});", empty_env],
                cwd=ROOT / 'frontend', env=env)
    web = ROOT / 'frontend/dist'
    if not (web / 'index.html').is_file():
        raise ValueError('Build frontend first')
    with tempfile.TemporaryDirectory(prefix='coreops-deb-') as temporary:
        stage = Path(temporary)
        def copy(source, target, mode=0o644):
            dest = stage / target.lstrip('/')
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, dest)
            dest.chmod(mode)
        binary = stage / 'usr/bin/coreops-api'
        binary.parent.mkdir(parents=True)
        env = dict(os.environ, GOOS='linux', GOARCH=architecture, CGO_ENABLED='0', SOURCE_DATE_EPOCH=epoch)
        flags = (f'-s -w -X main.buildVersion={version} -X main.buildCommit={commit} '
                 '-X github.com/ppdev28/CoreOps/backend/internal/adapters/helperpath.Directory=/usr/libexec/coreops')
        run(['go', 'build', '-trimpath', '-buildvcs=false', '-ldflags', flags,
             '-o', str(binary), './cmd/coreops-api'], cwd=ROOT / 'backend', env=env)
        binary.chmod(0o755)
        shutil.copytree(web, stage / 'usr/share/coreops/web')
        for helper in HELPERS:
            copy(ROOT / 'deploy' / helper, f'/usr/libexec/coreops/{helper}', 0o755)
        wrapper = stage / 'usr/libexec/coreops/coreops-security'
        wrapper.write_text(wrapper.read_text().replace('/usr/local/libexec/', '/usr/libexec/coreops/'))
        copy(ROOT / 'deploy/coreops-setup', '/usr/sbin/coreops-setup', 0o755)
        copy(ROOT / 'deploy/coreops.service', '/usr/lib/systemd/system/coreops.service')
        copy(ROOT / 'deploy/debian/coreops.env', '/etc/coreops/coreops.env', 0o600)
        for name in ('postinst', 'prerm', 'postrm'):
            copy(ROOT / 'deploy/debian' / name, '/DEBIAN/' + name, 0o755)
        metadata = {'version': version, 'commit': commit, 'architecture': architecture,
                    'dirty': dirty, 'sourceDateEpoch': int(epoch)}
        doc = stage / 'usr/share/doc/coreops'; doc.mkdir(parents=True)
        (doc / 'build-info.json').write_text(json.dumps(metadata, indent=2) + '\n')
        copy(ROOT / 'docs/modules/operations.md', '/usr/share/doc/coreops/modules/operations.md')
        copy(ROOT / 'docs/modules/services.md', '/usr/share/doc/coreops/modules/services.md')
        copy(ROOT / 'docs/installation.md', '/usr/share/doc/coreops/installation.md')
        copy(ROOT / 'docs/system-install-validation-2026-11-22.md', '/usr/share/doc/coreops/system-install-validation-2026-11-22.md')
        copy(ROOT / 'docs/services-permissions-validation-2026-11-23.md', '/usr/share/doc/coreops/services-permissions-validation-2026-11-23.md')
        # Do not assign a license on the author's behalf.
        (doc / 'copyright').write_text('CoreOps: project redistribution license not yet declared.\n'
            'Development package for private validation; review licenses before publishing.\n'
            'Third-party notices: /usr/share/doc/coreops/licenses/\n')
        shutil.copytree(ROOT / 'frontend/licenses', doc / 'licenses')
        shutil.copytree(ROOT / 'frontend/public/licenses', doc / 'licenses/assets')
        control = stage / 'DEBIAN'
        size = sum(p.stat().st_size for p in stage.rglob('*') if p.is_file()) // 1024
        (control / 'control').write_text(f'''Package: coreops
Version: {version}
Architecture: {architecture}
Maintainer: CoreOps maintainers <noreply@github.com>
Section: admin
Priority: optional
Installed-Size: {size}
Depends: adduser, init-system-helpers, systemd (>= 252), python3 (>= 3.11), sudo, ca-certificates, iproute2, procps, util-linux, bash
Suggests: docker.io
Homepage: https://github.com/ppdev28/CoreOps
Description: Self-hosted infrastructure control plane
 Native host service and bundled web interface for operational administration.
 Configure identity and opt-in host privileges with coreops-setup.
''')
        (control / 'conffiles').write_text('/etc/coreops/coreops.env\n')
        for p in stage.rglob('*'):
            if p.is_symlink():
                raise ValueError('Package staging must not contain symlinks')
            if p.is_dir(): p.chmod(0o755)
            else: p.chmod(p.stat().st_mode & 0o755)
            os.utime(p, (int(epoch), int(epoch)))
        artifact = output / f'coreops_{version}_{architecture}.deb'
        run(['dpkg-deb', '--root-owner-group', '-Zxz', '--build', str(stage), str(artifact)],
            env=dict(os.environ, SOURCE_DATE_EPOCH=epoch))
        metadata['sha256'] = hashlib.sha256(artifact.read_bytes()).hexdigest()
        (output / (artifact.name + '.json')).write_text(json.dumps(metadata, indent=2) + '\n')
        print(artifact)
        return artifact


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--arch', choices=['amd64', 'arm64'], default=subprocess.check_output(['dpkg', '--print-architecture'], text=True).strip())
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/packages')
    parser.add_argument('--frontend-built', action='store_true', help='Reuse frontend from this release job')
    args = parser.parse_args()
    build(args.version, args.arch, args.output.resolve(), args.frontend_built)


if __name__ == '__main__':
    main()
