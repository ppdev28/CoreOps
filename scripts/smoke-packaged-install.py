#!/usr/bin/env python3
"""Root integration test ONLY in a disposable container with the .deb installed.

Uses real API/users/files/sudoers, and a private systemctl stub to exercise setup
and rollback. Does not pretend the container runs a real systemd PID 1.
"""
import hashlib
import json
import os
from pathlib import Path
import pwd
import secrets
import signal
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request


def main():
    if os.geteuid() != 0 or not Path('/.dockerenv').exists() or os.environ.get('COREOPS_PACKAGE_TEST') != '1':
        raise SystemExit('Run only inside the disposable package-test container')
    assert not Path('/etc/coreops/configured').exists(), 'Use a fresh container'
    fake = Path('/usr/sbin/systemctl')
    assert not fake.exists(), 'Do not replace a real systemctl'
    source_user = 'coreops-source-test'
    subprocess.run(['useradd', '--system', '--home', '/tmp', '--shell', '/usr/sbin/nologin', source_user], check=True)
    account = pwd.getpwnam(source_user)
    work = Path(tempfile.mkdtemp(prefix='coreops-install-smoke-')); work.chmod(0o755)
    data = work / 'source'; data.mkdir(mode=0o700); os.chown(data, account.pw_uid, account.pw_gid)
    env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'COREOPS_HOST': '127.0.0.1',
           'COREOPS_PORT': '18082', 'COREOPS_DATA_DIR': str(data),
           'COREOPS_FILES_ROOT': '/tmp', 'COREOPS_METRICS_TOKEN': secrets.token_urlsafe(32)}
    password = secrets.token_urlsafe(24)
    subprocess.run(['/usr/bin/coreops-api', 'user', 'add', 'migration-test', 'admin'],
        user=account.pw_uid, group=account.pw_gid, env=env, input=password.encode(), check=True)
    key = data / 'terminal-passwords.key'; key.write_bytes(os.urandom(32)); key.chmod(0o600); os.chown(key, account.pw_uid, account.pw_gid)
    # The stub is confined to this throwaway container and starts the real binary
    # with its actual new Unix account/environment, so inode/HTTP checks are real.
    fake.write_text('''#!/usr/bin/python3 -I
import json,os,pathlib,pwd,shlex,signal,subprocess,sys,time
p=pathlib.Path('/tmp/coreops-test-service.pid')
args=sys.argv[1:]
def stop():
 if p.exists():
  try: os.kill(int(p.read_text()),signal.SIGTERM)
  except ProcessLookupError: pass
  p.unlink(); time.sleep(.3)
if args[0]=='stop': stop()
elif args[0]=='is-active':
 if not p.exists(): sys.exit(3)
 try: os.kill(int(p.read_text()),0)
 except ProcessLookupError: sys.exit(3)
elif args[0]=='show': print(p.read_text())
elif args[0]=='restart':
 stop()
 failure=pathlib.Path('/tmp/coreops-fail-once')
 if failure.exists(): failure.unlink(); sys.exit(1)
 env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin'}
 for line in pathlib.Path('/etc/coreops/coreops.env').read_text().splitlines():
  if '=' in line and not line.startswith('#'):
   k,v=line.split('=',1);env[k]=shlex.split(v)[0]
 u=pwd.getpwnam('coreops')
 log=open('/tmp/coreops-test-service.log','ab')
 c=subprocess.Popen(['/usr/bin/coreops-api'],env=env,cwd='/var/lib/coreops',user=u.pw_uid,group=u.pw_gid,extra_groups=os.getgrouplist('coreops',u.pw_gid),stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 p.write_text(str(c.pid))
'''); fake.chmod(0o755)
    log = (work / 'source.log').open('wb')
    source = subprocess.Popen(['/usr/bin/coreops-api'], env=env, user=account.pw_uid, group=account.pw_gid, stdout=log, stderr=subprocess.STDOUT)
    threading.Thread(target=source.wait, daemon=True).start()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def request(port, path, body=None, token=None):
        headers = {'Content-Type': 'application/json'}
        if token: headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request(f'http://127.0.0.1:{port}/api/v1/' + path,
            data=json.dumps(body).encode() if body is not None else None, headers=headers)
        with opener.open(req, timeout=3) as response: return json.load(response)
    for _ in range(100):
        try: request(18082, 'health/live'); break
        except OSError: time.sleep(.1)
    token = request(18082, 'auth/login', {'username': 'migration-test', 'password': password})['token']
    before = {name: hashlib.sha256((data / name).read_bytes()).hexdigest() for name in ('users.json', 'sessions.json', 'terminal-passwords.key')}
    Path('/tmp/coreops-fail-once').touch()
    attempt = subprocess.run(['/usr/sbin/coreops-setup', '--migrate-pid', str(source.pid),
        '--enable', 'journal,power,security,updates,tailscale', '--port', '18083'], capture_output=True, text=True)
    assert attempt.returncode != 0 and 'Previous API restored' in attempt.stdout, attempt.stdout + attempt.stderr
    assert request(18082, 'auth/me', token=token)['name'] == 'migration-test'
    restored = next(int(word) for word in attempt.stdout.split('PID ', 1)[1].split('.')[:1])
    os.kill(restored, signal.SIGTERM); time.sleep(.5)
    for name, digest in before.items():
        assert hashlib.sha256((data / name).read_bytes()).hexdigest() == digest
        assert hashlib.sha256((Path('/var/lib/coreops') / name).read_bytes()).hexdigest() == digest
    subprocess.run(['/usr/sbin/coreops-setup', '--port', '18083'], check=True)
    assert request(18083, 'auth/me', token=token)['name'] == 'migration-test'
    assert request(18083, 'health/live')['version'] != 'dev'
    assert (Path('/var/lib/coreops/terminal-passwords.key').stat().st_mode & 0o777) == 0o600
    subprocess.run(['visudo', '-cf', '/etc/sudoers.d/coreops-service'], check=True)
    assert '/usr/libexec/coreops/coreops-power reboot' in Path('/etc/sudoers.d/coreops-service').read_text()
    # Add a capability without replacing existing permissions or identity.
    policy_path = Path('/etc/coreops/capabilities.json')
    previous_policy = json.loads(policy_path.read_text())
    subprocess.run(['/usr/sbin/coreops-setup', '--add', 'services', '--port', '18083'], check=True)
    policy = json.loads(policy_path.read_text())
    assert set(policy) == set(previous_policy) | {'services'}
    for name, digest in before.items():
        assert hashlib.sha256((Path('/var/lib/coreops') / name).read_bytes()).hexdigest() == digest
    sudoers = Path('/etc/sudoers.d/coreops-service').read_text()
    assert '/usr/libexec/coreops/coreops-power reboot' in sudoers
    assert '/usr/libexec/coreops/coreops-services check' in sudoers
    assert '/usr/libexec/coreops/coreops-services apply' in sudoers
    def helper(operation, body=None):
        return subprocess.run(['runuser', '-u', 'coreops', '--', '/usr/bin/sudo', '-n', '--',
            '/usr/libexec/coreops/coreops-services', operation],
            input=json.dumps(body).encode() if body is not None else b'', capture_output=True)
    check = helper('check')
    assert check.returncode == 0 and json.loads(check.stdout)['ready'], check.stderr
    # Confine all service effects to a stub in this disposable container. This
    # tests the real HTTP -> dedicated UID -> sudo -> root helper path, not PID 1.
    service_cli = Path('/usr/bin/systemctl')
    service_cli.rename(work / 'systemctl-original')
    unit = Path('/usr/lib/systemd/system/coreops-permissions-test.service')
    unit.write_text('[Unit]\nDescription=Disposable Services permission test\n')
    unit.chmod(0o644)
    service_cli.write_text('''#!/usr/bin/python3 -I
import pathlib,sys
args=sys.argv[1:]
assert args[:2]==['--no-ask-password','--no-pager'],args
action=args[2]; name=args[-1]
assert name in ('coreops-permissions-test.service','coreops-test-alias.service','coreops-test-power-alias.service'),args
if action=='show':
 canonical={'coreops-test-alias.service':'coreops.service','coreops-test-power-alias.service':'systemd-reboot.service'}.get(name,name)
 print('Id='+canonical+'\\nLoadState=loaded\\nTransient=no\\nFragmentPath=/usr/lib/systemd/system/coreops-permissions-test.service\\nSourcePath=\\nDropInPaths=')
else:
 assert args[3]=='--' and len(args)==5 and action in ('start','stop','restart'),args
 assert name=='coreops-permissions-test.service',args
 with open('/tmp/coreops-service-dispatches','a') as log: log.write(action+'\\n')
 pathlib.Path('/tmp/coreops-service-state').write_text('inactive' if action=='stop' else 'active')
'''); service_cli.chmod(0o755)
    for action in ('stop', 'start', 'restart'):
        result = request(18083, 'services/coreops-permissions-test.service/' + action, {}, token)
        assert result == {'ok': True, 'name': unit.name, 'action': action}, result
        assert Path('/tmp/coreops-service-state').read_text() == ('inactive' if action == 'stop' else 'active')
    dispatches = Path('/tmp/coreops-service-dispatches').read_text()
    for name in ('coreops.service', 'systemd-reboot.service', 'coreops-test-alias.service', 'coreops-test-power-alias.service'):
        try: request(18083, 'services/' + name + '/stop', {}, token)
        except urllib.error.HTTPError as error: assert error.code == 403
        else: raise AssertionError('Protected service was allowed: ' + name)
    unit.chmod(0o666)
    try: request(18083, 'services/' + unit.name + '/stop', {}, token)
    except urllib.error.HTTPError as error: assert error.code == 403
    else: raise AssertionError('User-writable service was allowed')
    assert Path('/tmp/coreops-service-dispatches').read_text() == dispatches
    invalid = helper('apply', {'unit': unit.name, 'action': 'enable'})
    assert invalid.returncode != 0 and json.loads(invalid.stdout)['code'] == 'invalid'
    forbidden = subprocess.run(['runuser', '-u', 'coreops', '--', '/usr/bin/sudo', '-n', '--',
        '/usr/bin/systemctl', '--version'], capture_output=True)
    assert forbidden.returncode != 0, 'Unrestricted systemctl sudo was granted'
    assert request(18083, 'auth/me', token=token)['name'] == 'migration-test'
    subprocess.run(['systemctl', 'stop', 'coreops'], check=True)
    print('PASS: real identity/keys/sessions migration, injected startup failure rollback, configured API under coreops, version/inode/sudoers, additive Services setup and real HTTP/sudo/helper actions and denials. systemd calls simulated; no host service/power/network mutations.')


if __name__ == '__main__': main()
