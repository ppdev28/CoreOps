#!/usr/bin/env python3
"""Generate promtool fixtures against the real configurable rule expressions."""
import json
from configure import ROOT

def main():
    # Two histogram buckets with 10% 5xx, p95 ~950ms. At 0.1 rps no API alert;
    # at >=1rps both fire after the configured five minute duration.
    def traffic(rate):
        labels='job="coreops-api",instance="api:8082",transport="http",method="GET",route="/api/v1/health"'
        return [
            {'series':'coreops_http_requests_total{'+labels+',code="200"}', 'values':f'0+{rate*54}x20'},
            {'series':'coreops_http_requests_total{'+labels+',code="500"}', 'values':f'0+{rate*6}x20'},
            {'series':'coreops_http_request_duration_seconds_bucket{'+labels+',code="200",le="0.1"}', 'values':f'0+{rate*6}x20'},
            {'series':'coreops_http_request_duration_seconds_bucket{'+labels+',code="200",le="1"}', 'values':f'0+{rate*60}x20'},
            {'series':'coreops_http_request_duration_seconds_bucket{'+labels+',code="200",le="+Inf"}', 'values':f'0+{rate*60}x20'},
        ]
    rules=json.loads((ROOT/'generated/config/rules.json').read_text())['groups'][0]['rules']
    def expected(name):
        r=next(r for r in rules if r['alert']==name)
        return {'exp_labels':{**r['labels'],'job':'coreops-api','instance':'api:8082'},'exp_annotations':{**r['annotations'],'summary':name+' on api:8082'}}
    tests=[
        {'name':'target failure waits and then recovers','interval':'1m','input_series':[{'series':'up{job="coreops-test",instance="test:1"}','values':'1 0 0 0 1 1'}],'alert_rule_test':[
            {'eval_time':'2m','alertname':'TargetDown','exp_alerts':[]},
            {'eval_time':'3m','alertname':'TargetDown','exp_alerts':[{'exp_labels':{'job':'coreops-test','instance':'test:1',**rules[0]['labels']},'exp_annotations':{**rules[0]['annotations'],'summary':'TargetDown on test:1'}}]},
            {'eval_time':'4m','alertname':'TargetDown','exp_alerts':[]}]},
        {'name':'low traffic never causes misleading ratio or latency alerts','interval':'1m','input_series':traffic(.1),'alert_rule_test':[{'eval_time':'10m','alertname':name,'exp_alerts':[]} for name in ['CoreOpsHTTP5xxHigh','CoreOpsLatencyHigh']]},
        {'name':'sustained high error and latency with sufficient requests','interval':'1m','input_series':traffic(2),'alert_rule_test':[{'eval_time':'10m','alertname':name,'exp_alerts':[expected(name)]} for name in ['CoreOpsHTTP5xxHigh','CoreOpsLatencyHigh']]},
        {'name':'missing traffic is not a healthy zero ratio or a latency alert','interval':'1m','input_series':[],'alert_rule_test':[{'eval_time':'10m','alertname':name,'exp_alerts':[]} for name in ['CoreOpsHTTP5xxHigh','CoreOpsLatencyHigh']]},
    ]
    host_labels={'job':'coreops-host','instance':'node:19100'}
    def host_expected(name,extra=None):
        r=next(r for r in rules if r['alert']==name)
        return {'exp_labels':{**r['labels'],**host_labels,**(extra or {})},'exp_annotations':{**r['annotations'],'summary':name+' on node:19100'}}
    tests.append({'name':'sustained host pressure with filesystem exclusions','interval':'1m','input_series':[
        {'series':'node_cpu_seconds_total{job="coreops-host",instance="node:19100",mode="idle",cpu="0"}','values':'0+0x20'},
        {'series':'node_memory_MemAvailable_bytes{job="coreops-host",instance="node:19100"}','values':'5+0x20'},
        {'series':'node_memory_MemTotal_bytes{job="coreops-host",instance="node:19100"}','values':'100+0x20'},
        *[{'series':f'node_filesystem_{metric}{{job="coreops-host",instance="node:19100",device="{device}",mountpoint="{mount}",fstype="{fstype}"}}','values':str(value)+'+0x20'}
          for device,mount,fstype,readonly in [('/dev/test','/','ext4',0),('/dev/readonly','/readonly','ext4',1),('tmpfs','/virtual','tmpfs',0),('/dev/docker','/var/lib/docker/data','ext4',0)]
          for metric,value in [('avail_bytes',5),('size_bytes',100),('readonly',readonly)]]] ,
        'alert_rule_test':[{'eval_time':'15m','alertname':name,'exp_alerts':[host_expected(name,{'device':'/dev/test','mountpoint':'/','fstype':'ext4'} if name=='HostDiskLow' else None)]} for name in ['HostCPUHigh','HostMemoryLow','HostDiskLow']]})
    (ROOT/'generated/config/rules.test.json').write_text(json.dumps({'rule_files':['rules.json'],'evaluation_interval':'15s','tests':tests},indent=2)+'\n')
if __name__=='__main__':main()
