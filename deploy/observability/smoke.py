#!/usr/bin/env python3
"""Read real series and prove pending -> firing -> recovery using ONLY our disposable target.
Requires a CoreOps viewer token FILE. Never stops CoreOps/exporters/user containers.
Run on the Linux host with the optional stack running. Timeout ~4 minutes (default for=2m).
"""
import argparse
import fcntl
import http.server
import json
import os
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from configure import ROOT, write

def get(base,path,token=None):
    headers={'Accept':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    with urllib.request.urlopen(urllib.request.Request(base.rstrip('/')+path,headers=headers),timeout=30) as r:
        return json.load(r)

def wait(check,message,seconds=210):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        value=check()
        if value:
            print(message,flush=True)
            return value
        time.sleep(3)
    raise RuntimeError('Timed out: '+message)

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body=b'# HELP coreops_test_target_alive Disposable observability smoke target\n# TYPE coreops_test_target_alive gauge\ncoreops_test_target_alive 1\n'
        self.send_response(200);self.send_header('Content-Type','text/plain; version=0.0.4');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def log_message(self,*args): pass

class TestServer(http.server.ThreadingHTTPServer):
    allow_reuse_address=True

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api',default='http://127.0.0.1:8082')
    parser.add_argument('--prometheus',default='http://127.0.0.1:19090')
    parser.add_argument('--token-file',type=Path,required=True)
    args=parser.parse_args()
    token=args.token_file.read_text().strip()
    request=lambda path:get(args.api,'/api/v1/observability/'+path,token)
    instant=lambda expr:get(args.prometheus,'/api/v1/query?'+urllib.parse.urlencode({'query':expr}))['data']['result']
    original=(ROOT/'generated/config/test-targets.json').read_text()
    if json.loads(original): raise RuntimeError('test-targets.json must be empty; refusing to modify existing targets')
    status=request('integrations')
    assert status['prometheus']['healthy'] and status['grafana']['healthy'],status
    summary=request('summary')
    assert any(t['kind']=='host' and t['health']=='up' for t in summary['targets']), 'No real host scrape'
    assert any(t['kind']=='coreops' and t['health']=='up' for t in summary['targets']), 'No real API scrape'
    host=next(r for r in summary['resources'] if r['kind']=='host')
    assert host['name']==os.uname().nodename, 'node_exporter is not reporting this host'
    now=int(time.time());window={'from':now-900,'to':now,'step':15}
    q={**window,'resource':'host','job':host['job'],'instance':host['instance'],'metrics':'host_cpu,host_memory,host_disk,host_rx,host_tx,host_uptime'}
    data=request('series?'+urllib.parse.urlencode(q))
    for metric in data['results']:
        assert not metric.get('error'),metric
        prom=get(args.prometheus,'/api/v1/query_range?'+urllib.parse.urlencode({'query':metric['metric']['expression'],'start':window['from'],'end':window['to'],'step':window['step']}))['data']['result']
        # Compare timestamp/value pairs, independent of upstream series ordering/extra labels.
        finite=lambda raw: None if raw in ('NaN','+Inf','-Inf') else float(raw)
        expected=sorted((int(float(t)*1000),finite(v)) for s in prom for t,v in s['values'])
        actual=sorted((p['time'],p['value']) for s in metric['data']['series'] for p in s['points'])
        assert actual==expected,metric['metric']['id']
    missing=request('series?'+urllib.parse.urlencode({**q,'instance':'coreops-observability-nonexistent-instance','metrics':'host_cpu'}))
    assert missing['results'][0]['data']['series']==[] and not missing['results'][0].get('error')
    link=request('grafana-link?'+urllib.parse.urlencode({**q,'kind':'host'}))['url']
    parsed=urllib.parse.urlparse(link);params=urllib.parse.parse_qs(parsed.query)
    assert parsed.path.endswith('/d/coreops-host') and params['from']==[str(window['from']*1000)] and params['var-instance']==[host['instance']]
    try:get(args.api,'/api/v1/observability/summary');raise AssertionError('Anonymous access accepted')
    except urllib.error.HTTPError as e:assert e.code==401
    print('PASS: real host identity, authenticated queries, six exact Prometheus series, missing data, filters and Grafana time/resource context.',flush=True)
    target=ROOT/'generated/config/test-targets.json'
    server=TestServer(('127.0.0.1',0),Handler);port=server.server_port
    run=lambda s:threading.Thread(target=s.serve_forever,daemon=True).start()
    instance=f'127.0.0.1:{port}'
    selected=lambda:[a for a in request('rules?'+urllib.parse.urlencode({'job':'coreops-test','instance':instance}))['alerts'] if a['name']=='TargetDown']
    try:
        run(server);write(target,json.dumps([{'targets':[instance]}]))
        wait(lambda:instant(f'up{{job="coreops-test",instance="{instance}"}}') and instant(f'up{{job="coreops-test",instance="{instance}"}}')[0]['value'][1]=='1','PASS: disposable test target scraped successfully',45)
        server.shutdown();server.server_close();server=None
        wait(lambda:any(a['state']=='pending' for a in selected()),'PASS: test target interruption -> pending',45)
        wait(lambda:any(a['state']=='firing' for a in selected()),'PASS: sustained interruption -> firing (Prometheus rule duration)')
        server=TestServer(('127.0.0.1',port),Handler);run(server)
        wait(lambda:instant(f'up{{job="coreops-test",instance="{instance}"}}')[0]['value'][1]=='1' and not selected(),'PASS: test target recovery -> scrape up and active alert removed',45)
    finally:
        if server:server.shutdown();server.server_close()
        write(target,original)
    print('PASS: collection -> storage -> authenticated query -> active alert -> investigation -> recovery. Test target removed; no incident history generated.',flush=True)

if __name__=='__main__':
    with open(ROOT/'generated/smoke.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        main()
