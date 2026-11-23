import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent


def load():
    loader = importlib.machinery.SourceFileLoader('services_helper', str(ROOT / 'coreops-services'))
    spec = importlib.util.spec_from_loader('services_helper', loader)
    module = importlib.util.module_from_spec(spec); loader.exec_module(module)
    return module


class ServicesHelperTests(unittest.TestCase):
    def setUp(self): self.s = load()

    def stdin(self, value):
        read, write = os.pipe(); os.write(write, value); os.close(write)
        stream = os.fdopen(read, 'r')
        self.addCleanup(stream.close)
        return stream

    def evidence(self, **changes):
        values = dict(Id='alsa-restore.service', LoadState='loaded',
            FragmentPath='/usr/lib/systemd/system/alsa-restore.service',
            SourcePath='', DropInPaths='', Transient='no')
        values.update(changes)
        return '\n'.join(k + '=' + v for k, v in values.items())

    def test_only_supported_units_operations_and_strict_input(self):
        for data in [b'{}', b'null', b'{"unit":"alsa-restore.service","action":"enable"}',
                     b'{"unit":"alsa-restore.service","action":"stop","force":true}',
                     b'{"unit":"alsa-restore.service","action":"stop","action":"start"}',
                     b'{"unit":"../ssh.service","action":"start"}',
                     b'{"unit":"-H.service","action":"start"}',
                     b'{"unit":"*.service","action":"start"}', b'x' * 2049]:
            with patch.object(self.s.sys, 'stdin', self.stdin(data)):
                with self.assertRaises(self.s.Rejected): self.s.read_request()

    def test_root_required_and_check_does_not_touch_services(self):
        with patch.object(self.s.os, 'geteuid', return_value=1000):
            with self.assertRaises(self.s.Rejected): self.s.main()
        with patch.object(self.s.os, 'geteuid', return_value=0), patch.object(self.s.sys, 'argv', ['helper', 'check']), patch.object(self.s, 'call') as call:
            self.assertTrue(self.s.main()['ready']); call.assert_not_called()

    def test_stop_uses_verified_canonical_unit_and_fixed_arguments(self):
        data = json.dumps({'unit': 'sound-restore.service', 'action': 'stop'}).encode()
        with patch.object(self.s.os, 'geteuid', return_value=0), patch.object(self.s.sys, 'argv', ['helper', 'apply']), patch.object(self.s.sys, 'stdin', self.stdin(data)), patch.object(self.s, 'trusted_file', return_value=True), patch.object(self.s, 'call', side_effect=[(0, self.evidence()), (0, '')]) as call:
            result = self.s.main()
            self.assertEqual(result['canonicalUnit'], 'alsa-restore.service')
            self.assertEqual(call.call_args_list[-1].args, (['stop', '--', 'alsa-restore.service'], 5))
            self.assertEqual(call.call_count, 2)

    def test_alias_cannot_bypass_coreops_or_power_protection(self):
        for canonical in ['coreops.service', 'systemd-reboot.service', 'systemd-poweroff.service', 'systemd-suspend.service']:
            with patch.object(self.s, 'call', return_value=(0, self.evidence(Id=canonical))) as call:
                with self.assertRaises(self.s.Rejected): self.s.checked_unit('alias.service')
                self.assertEqual(call.call_count, 1)

    def test_transient_masked_or_untrusted_services_cannot_dispatch(self):
        for metadata in [self.evidence(Transient='yes'), self.evidence(LoadState='masked'), self.evidence(FragmentPath='/tmp/user.service')]:
            with patch.object(self.s, 'call', return_value=(0, metadata)) as call, patch.object(self.s, 'trusted_file', return_value=False):
                with self.assertRaises(self.s.Rejected): self.s.checked_unit('alsa-restore.service')
                self.assertEqual(call.call_count, 1)
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / 'unit.service'; file.write_text('[Service]\n')
            self.assertFalse(self.s.trusted_file(file))
            alias = Path(temp) / 'borrowed-root-file.service'
            alias.symlink_to('/usr/bin/true')
            self.assertFalse(self.s.trusted_file(alias))

    def test_every_dropin_and_sysv_source_is_checked(self):
        metadata = self.evidence(SourcePath='/etc/init.d/sound', DropInPaths='/etc/systemd/system/sound.service.d/override.conf')
        with patch.object(self.s, 'call', return_value=(0, metadata)), patch.object(self.s, 'trusted_file', side_effect=[True, True, False]) as trust:
            with self.assertRaises(self.s.Rejected): self.s.checked_unit('alsa-restore.service')
            self.assertEqual(trust.call_count, 3)

    def test_failed_or_timed_out_dispatch_is_not_success(self):
        for result in [(1, 'Job failed'), TimeoutError('deadline'), subprocess.TimeoutExpired('systemctl', 5)]:
            data = json.dumps({'unit': 'alsa-restore.service', 'action': 'stop'}).encode()
            with patch.object(self.s.os, 'geteuid', return_value=0), patch.object(self.s.sys, 'argv', ['helper', 'apply']), patch.object(self.s.sys, 'stdin', self.stdin(data)), patch.object(self.s, 'checked_unit', return_value='alsa-restore.service'), patch.object(self.s, 'call', side_effect=result if isinstance(result, Exception) else [result]) as call:
                with self.assertRaises(self.s.Rejected): self.s.main()
                self.assertEqual(call.call_count, 1)

    def test_output_is_bounded_and_only_owned_child_is_killed(self):
        real_popen = subprocess.Popen
        def child(*args, **kwargs):
            return real_popen([sys.executable, '-c', "print('x'*9000)"], **kwargs)
        with patch.object(self.s.subprocess, 'Popen', side_effect=child):
            with self.assertRaises(ValueError): self.s.call(['show', '--', 'owned.service'], 2)

    @unittest.skipUnless(os.environ.get('COREOPS_TEST_SERVICES_READ_ONLY') == '1', 'opt-in read-only host evidence')
    def test_real_alsa_metadata_and_root_owned_paths_without_mutation(self):
        self.assertEqual(self.s.checked_unit('alsa-restore.service'), 'alsa-restore.service')


if __name__ == '__main__': unittest.main()
