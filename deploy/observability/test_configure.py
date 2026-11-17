import contextlib
import io
import os
import stat
from unittest import mock
import configure
import tempfile
import unittest
from pathlib import Path
from configure import configuration, rules
from render_dashboards import dashboard

class ConfigureTests(unittest.TestCase):
    def test_malformed_mount_paths_do_not_replace_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            generated=root/'generated'; generated.mkdir()
            (generated/'metrics-token').mkdir()
            password=generated/'grafana-password'; password.write_text('keep-existing-password')
            with mock.patch.object(configure,'ROOT',root),mock.patch.dict(os.environ,{},clear=True):
                with self.assertRaisesRegex(ValueError,'metrics-token'):
                    configure.main()
            self.assertTrue((generated/'metrics-token').is_dir())
            self.assertEqual(password.read_text(),'keep-existing-password')
            self.assertFalse((root/'.env').exists())
    def test_private_targets_and_metrics_auth(self):
        config=configuration({})
        self.assertEqual(config['global']['scrape_interval'],'15s')
        api,node,test=config['scrape_configs']
        self.assertEqual(api['static_configs'][0]['targets'],['127.0.0.1:8082'])
        self.assertEqual(api['authorization']['credentials_file'],'/run/secrets/metrics-token')
        self.assertEqual(node['static_configs'][0]['targets'],['127.0.0.1:19100'])
        for target in ['http://localhost:8082','user:secret@host:8082','localhost:8082/path']:
            with self.assertRaises(ValueError):configuration({'COREOPS_SCRAPE_TARGET':target})
    def test_thresholds_durations_and_traffic_gate(self):
        generated=rules({'ALERT_CPU_PERCENT':'70','ALERT_HOST_CPU_HIGH_FOR':'3m','ALERT_MIN_RPS':'2'})['groups'][0]['rules']
        self.assertEqual(len(generated),6)
        cpu=next(r for r in generated if r['alert']=='HostCPUHigh')
        self.assertTrue(cpu['expr'].endswith('> 70.0'))
        self.assertEqual(cpu['for'],'3m')
        for name in ['CoreOpsHTTP5xxHigh','CoreOpsLatencyHigh']:
            r=next(r for r in generated if r['alert']==name)
            self.assertIn('and on(job,instance)',r['expr']);self.assertIn('>= 2.0',r['expr']);self.assertIn('transport="http"',r['expr'])
        for env in [{'ALERT_CPU_PERCENT':'NaN'},{'ALERT_MIN_RPS':'0'},{'ALERT_TARGET_DOWN_FOR':'0s'},{'ALERT_P95_SECONDS':'Infinity'}]:
            with self.assertRaises(ValueError):rules(env)
    def test_generated_credentials_remain_private_and_stable(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            output=io.StringIO()
            with mock.patch.object(configure,'ROOT',root),mock.patch.dict(os.environ,{},clear=True),contextlib.redirect_stdout(output):
                configure.main()
                token=(root/'generated/metrics-token').read_text()
                password=(root/'generated/grafana-password').read_text()
                configure.main()
            self.assertEqual((root/'generated/metrics-token').read_text(),token)
            self.assertEqual((root/'generated/grafana-password').read_text(),password)
            self.assertNotIn(token.strip(),output.getvalue())
            self.assertNotIn(password.strip(),output.getvalue())
            for path,mode in [('generated',0o700),('generated/metrics-token',0o640),('generated/grafana-password',0o640),('.env',0o600),('generated/coreops.env',0o600)]:
                self.assertEqual(stat.S_IMODE((root/path).stat().st_mode),mode)

    def test_dashboard_shared_context_and_real_gaps(self):
        d=dashboard('host','Host',[('CPU','percent','up','{{instance}}')])
        self.assertEqual(d['uid'],'coreops-host')
        self.assertEqual([v['name'] for v in d['templating']['list']],['job','instance'])
        self.assertFalse(d['panels'][0]['fieldConfig']['defaults']['custom']['spanNulls'])

if __name__=='__main__':unittest.main()
