"""Exercise a private helper copy against a fake logind; never request host power."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent


class PowerHelperTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        self.calls = self.root / "calls.jsonl"
        self.identity = self.root / "id"
        self.identity.write_text("#!/bin/sh\nprintf '0\\n'\n")
        self.identity.chmod(0o700)
        self.bus = self.root / "busctl"
        self.bus.write_text("#!/usr/bin/python3 -I\n" + f"""
import json, sys
from pathlib import Path
args = sys.argv[1:]
with Path({str(self.calls)!r}).open('a') as output:
    output.write(json.dumps(args) + '\\n')
method = args[-1] if args[-1].startswith('Can') else args[-3]
if method.startswith('Can'):
    print('s "yes"')
    raise SystemExit(0)
expected = ['--system', '--timeout=4', '--allow-interactive-authorization=no',
            'call', 'org.freedesktop.login1', '/org/freedesktop/login1',
            'org.freedesktop.login1.Manager', method, 't', '1']
assert args == expected
# Logged-in sessions must not prevent the confirmed operation. A real block
# inhibitor must still reject it; flag 1 is required even when caller is root.
state = json.loads(Path({str(self.root / 'state')!r}).read_text())
assert state['loggedInSessions'] > 0
if state['inhibitor'] == 'block':
    print('Call failed: Operation inhibited', file=sys.stderr)
    raise SystemExit(1)
""")
        self.bus.chmod(0o700)
        # Only this private test copy redirects fixed executables. The production
        # helper has no environment overrides or user-selected command paths.
        self.helper = self.root / "helper"
        self.helper.write_text((ROOT / "coreops-power").read_text()
                               .replace('/usr/bin/id', str(self.identity))
                               .replace('/usr/bin/busctl', str(self.bus)))

    def invoke(self, *args, inhibitor="delay"):
        (self.root / "state").write_text(json.dumps({
            "loggedInSessions": 3, "inhibitor": inhibitor,
        }))
        return subprocess.run(['/bin/sh', str(self.helper), *args],
                              env={"PATH": "/usr/bin:/bin"},
                              capture_output=True, text=True, timeout=3)

    def read_calls(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def test_logged_in_sessions_and_delay_do_not_block_confirmed_actions(self):
        for action, method in [('reboot', 'RebootWithFlags'),
                               ('poweroff', 'PowerOffWithFlags'),
                               ('suspend', 'SuspendWithFlags')]:
            result = self.invoke(action)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.read_calls()[-1][-3:], [method, 't', '1'])
        self.assertEqual(len(self.read_calls()), 3)

    def test_block_inhibitor_is_respected_without_retry_or_fallback(self):
        result = self.invoke('reboot', inhibitor='block')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('inhibited', result.stderr)
        self.assertEqual(len(self.read_calls()), 1)

    def test_status_never_dispatches(self):
        result = self.invoke('status')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['states']['reboot'], 'yes')
        self.assertEqual([call[-1] for call in self.read_calls()],
                         ['CanPowerOff', 'CanReboot', 'CanSuspend'])

    def test_invalid_arguments_never_dispatch(self):
        for args in [(), ('reboot', '--force'), ('reboot; id',), ('RebootWithFlags',)]:
            self.assertEqual(self.invoke(*args).returncode, 64)
        self.assertEqual(self.read_calls(), [])

    def test_non_root_cannot_query_or_dispatch(self):
        self.identity.write_text("#!/bin/sh\nprintf '1000\\n'\n")
        for action in ['status', 'reboot']:
            self.assertEqual(self.invoke(action).returncode, 77)
        self.assertEqual(self.read_calls(), [])


if __name__ == '__main__':
    unittest.main()
