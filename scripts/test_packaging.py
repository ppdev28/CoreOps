import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec); loader.exec_module(module)
    return module


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.s = load('setup', ROOT / 'deploy/coreops-setup')
        self.work = tempfile.TemporaryDirectory(); self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)

    def test_environment_is_data_not_executed_and_round_trips(self):
        values = {'COREOPS_HOST': '127.0.0.1', 'COREOPS_TEST': 'spaces $`() " \\ and \' quote'}
        file = self.root / 'env'; file.write_text(self.s.env_text(values))
        self.assertEqual(self.s.env_read(file), values)
        for bad in [{'COREOPS_TEST': 'line\nbreak'}, {'COREOPS_TEST\nINJECT': 'bad'}, {'LD_PRELOAD': 'bad'}]:
            with self.assertRaises(ValueError): self.s.env_text(bad)

    def test_policy_has_only_explicit_operations(self):
        self.assertNotIn('NOPASSWD', self.s.sudo_policy(set()))
        power = self.s.sudo_policy({'power'})
        self.assertIn('/usr/libexec/coreops/coreops-power reboot', power)
        self.assertNotIn('coreops-packages', power)
        self.assertNotIn(' /bin/sh', power)
        self.assertNotIn(' *', power)
        security = self.s.sudo_policy({'security'})
        self.assertNotIn('enable-auto-updates', security)
        self.assertIn('enable-auto-updates', self.s.sudo_policy({'security-timer'}))
        services = self.s.sudo_policy({'services'})
        self.assertIn('/usr/libexec/coreops/coreops-services check', services)
        self.assertIn('/usr/libexec/coreops/coreops-services apply', services)
        self.assertNotIn('/usr/bin/systemctl', services)
        self.assertNotIn(' *', services)

    def test_services_addition_does_not_replace_existing_policy(self):
        # Inspect the dry-run contract without needing root access to live config.
        output = subprocess.check_output(['python3', '-I', str(ROOT / 'deploy/coreops-setup'), '--dry-run', '--add', 'services'], text=True)
        plan = json.loads(output)
        self.assertEqual(plan['capabilitiesToAdd'], ['services'])
        self.assertTrue(plan['preserveExistingCapabilities'])
        self.assertFalse(plan['changesMade'])

    def test_copy_preserves_secrets_and_never_changes_source(self):
        source = self.root / 'source'; source.mkdir()
        (source / 'terminal-passwords.key').write_bytes(b'private-test-key')
        (source / 'users.json').write_text('{"owned":{"role":"admin"}}')
        (source / 'nested').mkdir(); (source / 'nested/config').write_text('private')
        dest = self.root / 'dest'; dest.mkdir()
        self.s.copy_private_tree(source, dest, os.getuid(), os.getgid())
        self.assertEqual((dest / 'terminal-passwords.key').read_bytes(), b'private-test-key')
        self.assertEqual((source / 'terminal-passwords.key').read_bytes(), b'private-test-key')
        for file in dest.rglob('*'):
            self.assertEqual(file.stat().st_mode & 0o777, 0o700 if file.is_dir() else 0o600)

    def test_copy_refuses_symlinks_hardlinks_and_devices(self):
        source = self.root / 'source'; source.mkdir()
        private = self.root / 'private'; private.write_text('never-follow')
        dest = self.root / 'dest'; dest.mkdir()
        (source / 'link').symlink_to(private)
        with self.assertRaises(ValueError): self.s.copy_private_tree(source, dest, os.getuid(), os.getgid())
        (source / 'link').unlink(); os.link(private, source / 'link')
        with self.assertRaises(ValueError): self.s.copy_private_tree(source, dest, os.getuid(), os.getgid())
        (source / 'link').unlink(); os.mkfifo(source / 'fifo')
        with self.assertRaises(ValueError): self.s.copy_private_tree(source, dest, os.getuid(), os.getgid())

    def test_atomic_files_are_private_and_refuse_symlink(self):
        file = self.root / 'config'; self.s.atomic(file, 'private')
        self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        file.unlink(); file.symlink_to(self.root / 'outside')
        with self.assertRaises(ValueError): self.s.atomic(file, 'private')
        self.assertFalse((self.root / 'outside').exists())

    def test_nonroot_apply_cannot_mutate(self):
        with patch.object(self.s.os, 'geteuid', return_value=1000), patch.object(self.s, 'run') as run:
            args = type('Args', (), dict(enable='power', bind=None, migrate_pid=None, dry_run=False))()
            with self.assertRaisesRegex(ValueError, 'sudo'): self.s.configure(args)
            run.assert_not_called()

    def test_stops_only_owned_disposable_api_using_pidfd(self):
        source = self.root / 'data'; source.mkdir()
        code = "import ctypes,time;ctypes.CDLL(None).prctl(15,b'coreops-api',0,0,0);time.sleep(30)"
        child = subprocess.Popen(['/usr/bin/python3', '-c', code], env=dict(os.environ, COREOPS_DATA_DIR=str(source)))
        self.addCleanup(lambda: child.kill() if child.poll() is None else None)
        for _ in range(100):
            if Path('/proc', str(child.pid), 'comm').read_text().strip() == 'coreops-api': break
            time.sleep(.01)
        info = self.s.process_info(child.pid)
        reaper = threading.Thread(target=child.wait); reaper.start()
        self.s.stop_source(info); reaper.join(timeout=2)
        self.assertEqual(child.returncode, -15)

    def test_migration_pid_must_be_api(self):
        with self.assertRaises(ValueError): self.s.process_info(os.getpid())


if __name__ == '__main__': unittest.main()
