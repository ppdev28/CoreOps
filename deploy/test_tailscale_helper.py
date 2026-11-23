"""Tests import the helper with a simulated daemon; never touch host Tailscale."""
import importlib.machinery
import importlib.util
import pathlib
import unittest
from unittest.mock import patch
loader = importlib.machinery.SourceFileLoader("restricted_tailscale", str(pathlib.Path(__file__).with_name("coreops-tailscale")))
spec = importlib.util.spec_from_loader(loader.name, loader)
helper = importlib.util.module_from_spec(spec)
loader.exec_module(helper)
class RestrictedHelperTest(unittest.TestCase):
    def test_rejects_arbitrary_operations_and_preferences(self):
        invalid = [
            {"action":"logout","changes":{}},
            {"action":"configure","changes":{"operator":"user"}},
            {"action":"configure","changes":{"hostname":"host;reboot"}},
            {"action":"configure","changes":{"acceptDNS":1}},
            {"action":"configure","changes":{"ssh":"false"}},
            {"action":"connect","changes":{"shieldsUp":False}},
            {"action":"configure","changes":{}},
            {"action":"disconnect","changes":{},"socket":"/tmp/other"},
        ]
        for request in invalid:
            with self.subTest(request=request), self.assertRaises(ValueError):
                helper.validate(request)
        with self.assertRaises(ValueError):
            helper.unique_object([("action","connect"),("action","login")])
    def test_only_changed_flags_are_masked(self):
        calls=[]
        def call(method,path,payload=None):
            calls.append((method,path,payload))
            if path.startswith("status"):return {"BackendState":"Running","Self":{"ID":"node-test"}}
            if path=="prefs" and method=="GET":return {"Hostname":"original","CorpDNS":True,"RouteAll":False,"RunSSH":True,"ShieldsUp":False,"WantRunning":True,"ExitNodeID":"preserve-me"}
            return {}
        with patch.object(helper,"call",call):
            helper.apply({"action":"configure","changes":{"acceptDNS":False,"hostname":"new-host"}})
        self.assertEqual(calls[-1],("PATCH","prefs",{"CorpDNS":False,"CorpDNSSet":True,"Hostname":"new-host","HostnameSet":True}))
        self.assertNotIn("ExitNodeID",calls[-1][2])
    def test_login_cannot_reauthenticate_a_connected_host(self):
        def call(method,path,payload=None):
            if method != "GET":self.fail("connected host was changed")
            return {"BackendState":"Running","Self":{"ID":"node-test"}} if path.startswith("status") else {"WantRunning":True}
        with patch.object(helper,"call",call), self.assertRaises(ValueError):
            helper.apply({"action":"login","changes":{}})
    def test_disconnect_only_changes_want_running(self):
        calls=[]
        def call(method,path,payload=None):
            calls.append((method,path,payload))
            if path.startswith("status"):return {"BackendState":"Running","Self":{"ID":"node-test"}}
            if method=="GET":return {"WantRunning":True}
            return {}
        with patch.object(helper,"call",call):helper.apply({"action":"disconnect","changes":{}})
        self.assertEqual(calls[-1],("PATCH","prefs",{"WantRunning":False,"WantRunningSet":True}))
    def test_login_never_accepts_auth_keys_or_resets_preferences(self):
        calls=[]
        def call(method,path,payload=None):
            calls.append((method,path,payload))
            return {"BackendState":"NeedsLogin"} if path.startswith("status") else {}
        with patch.object(helper,"call",call):helper.apply({"action":"login","changes":{}})
        self.assertEqual([(m,p) for m,p,_ in calls[-3:]],[('POST','start'),('PATCH','prefs'),('POST','login-interactive')])
        self.assertTrue(all("AuthKey" not in (data or {}) for _,_,data in calls))
if __name__=="__main__":unittest.main()
