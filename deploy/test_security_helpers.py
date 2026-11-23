import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent

def load(name, filename):
    loader = importlib.machinery.SourceFileLoader(name, str(ROOT / filename))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module

class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.e = load("evidence", "coreops-security-evidence")

    def test_ssh_context_is_bounded_and_fixed_argv(self):
        for value in ({"user": "--help", "address": "192.0.2.1", "host": ""}, {"user": "pepe", "address": "bad", "host": ""}, {"user": "pepe", "address": "192.0.2.1", "host": "", "args": "evil"}):
            stdin = types.SimpleNamespace(buffer=io.BytesIO(json.dumps(value).encode()))
            with patch.object(self.e.os, "geteuid", return_value=0), patch.object(self.e.sys, "argv", ["helper", "sshd-context"]), patch.object(self.e.sys, "stdin", stdin), patch.object(self.e, "call") as call:
                try:
                    result = self.e.main()
                    self.assertEqual(result, 64)
                except ValueError:
                    pass
                call.assert_not_called()
        value = {"user": "pepe", "address": "192.0.2.1", "host": "host.example"}
        with patch.object(self.e.os, "geteuid", return_value=0), patch.object(self.e.sys, "argv", ["helper", "sshd-context"]), patch.object(self.e.sys, "stdin", types.SimpleNamespace(buffer=io.BytesIO(json.dumps(value).encode()))), patch.object(self.e, "call", return_value="policy") as call, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.e.main(), 0)
            call.assert_called_once_with("/usr/sbin/sshd", "-T", "-C", "user=pepe,addr=192.0.2.1,host=host.example")

    def test_jail_names_cannot_add_commands_or_paths(self):
        with patch.object(self.e.os, "geteuid", return_value=0), patch.object(self.e.sys, "argv", ["helper", "fail2ban-details"]), patch.object(self.e, "call", return_value="Number of jail: 2\nJail list: sshd, ../../bad") as call:
            self.assertEqual(self.e.main(), 64)
            self.assertEqual(call.call_count, 1)

    def test_output_limit_kills_only_owned_test_child(self):
        self.e.DEADLINE = time.monotonic() + 2
        with self.assertRaises(ValueError):
            self.e.call(sys.executable, "-c", "print('x'*70000)")

    def test_jail_unknown_fields_are_partial(self):
        with patch.object(self.e, "call", side_effect=ValueError("denied")):
            self.assertEqual(self.e.jail_details("sshd")["status"]["state"], "partial")
        def empty_jail(*args):
            if args[-1] in ("maxretry", "findtime", "bantime"):
                return "5"
            return "[]"
        with patch.object(self.e, "call", side_effect=empty_jail):
            jail = self.e.jail_details("sshd")
            self.assertEqual(jail["failRegexCount"], 0)
            self.assertEqual(jail["logPaths"], [])
            self.assertEqual(jail["status"]["state"], "partial")


class SSHHardeningTests(unittest.TestCase):
    def setUp(self):
        self.s = load("hardening", "harden-openssh.py")
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        self.s.ROOT = self.root / "state"
        self.s.DROPIN = self.root / "config" / "00.conf"
        self.s.INSTALLED = self.root / "libexec" / "hardening"
        self.s.SSH_CONFIG = self.root / "sshd_config"
        self.s.SSH_CONFIG.write_text("Include config/*.conf\n")
        self.calls = []

    def run_fake(self, *args, capture=False):
        self.calls.append(args)
        if "--value" in args:
            return "active\n"
        if "-T" in args:
            return self.s.POLICY.decode().replace("PasswordAuthentication", "passwordauthentication").replace("KbdInteractiveAuthentication", "kbdinteractiveauthentication").replace("PermitRootLogin", "permitrootlogin").replace("PubkeyAuthentication", "pubkeyauthentication").replace("AuthenticationMethods", "authenticationmethods")
        return ""

    def mkdir(self, path):
        path.mkdir(parents=True, exist_ok=True)

    def test_rollback_is_scheduled_before_reload(self):
        with patch.object(self.s, "check_user"), patch.object(self.s, "safe_directory", side_effect=self.mkdir), patch.object(self.s, "run", side_effect=self.run_fake), contextlib.redirect_stdout(io.StringIO()):
            self.s.apply("pepe")
        timer = next(i for i, args in enumerate(self.calls) if args[0] == "/usr/bin/systemd-run")
        reload = next(i for i, args in enumerate(self.calls) if "reload" in args)
        self.assertLess(timer, reload)
        token = next(self.s.ROOT.iterdir()).name
        self.assertTrue(self.s.TOKEN.fullmatch(token))
        with patch.object(self.s, "run", side_effect=self.run_fake), contextlib.redirect_stdout(io.StringIO()):
            self.s.rollback(token)
        self.assertFalse(self.s.DROPIN.exists())

    def test_match_policies_require_review_before_any_change(self):
        self.s.SSH_CONFIG.write_text("Match User root\n PermitRootLogin yes\n")
        with patch.object(self.s, "check_user"), patch.object(self.s, "run") as run:
            with self.assertRaises(ValueError):
                self.s.apply("pepe")
            run.assert_not_called()
        self.assertFalse(self.s.ROOT.exists())

    def test_existing_policy_is_restored_if_validation_fails(self):
        self.s.DROPIN.parent.mkdir(parents=True)
        self.s.DROPIN.write_text("# original policy\n")
        def run(*args, capture=False):
            return "active\n" if "--value" in args else "passwordauthentication yes\n" if "-T" in args else ""
        with patch.object(self.s, "check_user"), patch.object(self.s, "safe_directory", side_effect=self.mkdir), patch.object(self.s, "run", side_effect=run), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(ValueError):
                self.s.apply("pepe")
        self.assertEqual(self.s.DROPIN.read_text(), "# original policy\n")

    def test_installer_rejects_unprivileged_activation(self):
        module = load("protection", "install-security-protection.py")
        with patch.object(module.os, "geteuid", return_value=1000), patch.object(module.sys if hasattr(module, "sys") else sys, "argv", ["installer"]), patch.object(module, "run") as run:
            with self.assertRaises(PermissionError):
                module.main()
            run.assert_not_called()

if __name__ == "__main__":
    unittest.main()
