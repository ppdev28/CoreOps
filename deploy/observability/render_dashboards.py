#!/usr/bin/env python3
"""Reproduce the checked-in Grafana dashboards using only Python's stdlib."""
import json
from pathlib import Path
from configure import FILESYSTEM, MOUNTS, NETWORK

ROOT = Path(__file__).resolve().parent
DS = {'type':'prometheus','uid':'coreops-prometheus'}

def dashboard(kind, title, metrics):
    job = 'coreops-host' if kind == 'host' else 'coreops-api'
    panels = []
    for i,(name,unit,expression,legend) in enumerate(metrics):
        panels.append({'id':i+1,'title':name,'type':'timeseries','datasource':DS,'gridPos':{'h':8,'w':12,'x':12*(i%2),'y':8*(i//2)},'targets':[{'refId':'A','expr':expression,'legendFormat':legend}], 'fieldConfig':{'defaults':{'unit':unit,'custom':{'drawStyle':'line','lineInterpolation':'linear','spanNulls':False}},'overrides':[]},'options':{'legend':{'displayMode':'list','placement':'bottom'},'tooltip':{'mode':'multi'}}})
    return {'uid':f'coreops-{kind if kind=="host" else "backend"}','title':title,'schemaVersion':40,'version':1,'tags':['CoreOps','provisioned'],'timezone':'browser','editable':False,'refresh':'30s','time':{'from':'now-1h','to':'now'},'description':'Provisioned by CoreOps. A successful scrape is not a guarantee of application health. Missing samples remain gaps.', 'templating':{'list':[
        {'name':'job','label':'Job','type':'query','datasource':DS,'query':{'query':'label_values(up, job)','refId':'job'},'refresh':1,'multi':False,'includeAll':False,'current':{'text':job,'value':job}},
        {'name':'instance','label':'Instance','type':'query','datasource':DS,'query':{'query':'label_values(up{job="$job"}, instance)','refId':'instance'},'refresh':1,'multi':True,'includeAll':True,'allValue':'.*','current':{'text':'All','value':'$__all'}},
    ]},'panels':panels}

def main():
    n='{job="$job",instance=~"$instance"}'
    f='{job="$job",instance=~"$instance",fstype!~'+json.dumps(FILESYSTEM)+',mountpoint!~'+json.dumps(MOUNTS)+'}'
    net='{job="$job",instance=~"$instance",device!~'+json.dumps(NETWORK)+'}'
    host=[
        ('CPU non-idle (5m)','percent',f'100 * (1 - avg by(job,instance)(rate(node_cpu_seconds_total{{job="$job",instance=~"$instance",mode="idle"}}[5m])))','{{instance}}'),
        ('Memory used (total minus available)','percent',f'100 * (1 - node_memory_MemAvailable_bytes{n}/node_memory_MemTotal_bytes{n})','{{instance}}'),
        ('Writable filesystem occupancy','percent',f'(100 * (1 - node_filesystem_avail_bytes{f}/node_filesystem_size_bytes{f})) and on(job,instance,device,mountpoint) (node_filesystem_readonly{f} == 0)','{{instance}} {{mountpoint}}'),
        ('Uptime','s',f'time() - node_boot_time_seconds{n}','{{instance}}'),
        ('Network receive (5m)','Bps',f'sum by(job,instance)(rate(node_network_receive_bytes_total{net}[5m]))','{{instance}} RX'),
        ('Network transmit (5m)','Bps',f'sum by(job,instance)(rate(node_network_transmit_bytes_total{net}[5m]))','{{instance}} TX'),
        ('Scrape result','short',f'up{n}','{{instance}}'),
    ]
    a='{job="$job",instance=~"$instance",transport="http"}'
    traffic=f'sum(rate(coreops_http_requests_total{a}[5m]))'
    errors='sum(rate(coreops_http_requests_total{job="$job",instance=~"$instance",transport="http",code=~"5.."}[5m]))'
    backend=[('HTTP traffic (5m)','reqps',traffic,'requests/s'),('HTTP 5xx ratio (no traffic = unavailable)','percent',f'100 * ({errors} or (0 * {traffic})) / {traffic}','5xx %')]
    backend.extend((f'Latency p{int(q*100)} (5m)','s',f'histogram_quantile({q},sum by(le)(rate(coreops_http_request_duration_seconds_bucket{a}[5m])))',f'p{int(q*100)}') for q in (.5,.95,.99))
    backend.extend([
        ('HTTP in flight','short',f'sum(coreops_http_requests_in_flight{a})','requests'),
        ('Process resident memory','bytes',f'sum(process_resident_memory_bytes{n})','RSS'),
        ('Go goroutines','short',f'sum(go_goroutines{n})','goroutines'),
        ('Top 20 normalized routes (5m)','reqps',f'topk(20,sum by(method,route)(rate(coreops_http_requests_total{a}[5m])))','{{method}} {{route}}'),
    ])
    for kind,title,metrics in [('host','CoreOps · Host',host),('backend','CoreOps · Backend',backend)]:
        (ROOT/'grafana/dashboards'/f'{kind}.json').write_text(json.dumps(dashboard(kind,title,metrics),indent=2)+'\n')

if __name__=='__main__': main()
