#!/usr/bin/env python3
"""Render JSON (valid YAML) without dependencies. Secrets never enter git/stdout."""
import json
import os
from pathlib import Path
import re
import secrets

ROOT = Path(__file__).resolve().parent
FILESYSTEM = 'tmpfs|devtmpfs|overlay|squashfs|proc|sysfs|cgroup.*|nsfs|autofs|tracefs|debugfs|securityfs|pstore|fusectl|ramfs'
MOUNTS = '^/(dev|proc|sys|run|var/lib/docker|var/lib/containers)($|/).*'
NETWORK = 'lo|veth.*|docker.*|br-.*|cni.*|flannel.*|virbr.*|tailscale.*|tun.*|tap.*'

def number(env, name, default, lo=0, hi=100):
    value = float(env.get(name, default))
    if not lo <= value <= hi:
        raise ValueError(f'{name} must be between {lo} and {hi}')
    return value

def duration(env, name, default):
    value = env.get(name, default)
    if not re.fullmatch(r'[1-9][0-9]{0,5}[smh]', value):
        raise ValueError(f'{name} must be a positive duration in s, m or h')
    return value

def rules(env):
    node, api = json.dumps(env.get('COREOPS_PROMETHEUS_NODE_JOB', 'coreops-host')), json.dumps(env.get('COREOPS_PROMETHEUS_API_JOB', 'coreops-api'))
    n = f'{{job={node}}}'
    fs = f'{{job={node},fstype!~{json.dumps(FILESYSTEM)},mountpoint!~{json.dumps(MOUNTS)}}}'
    traffic = f'sum by(job,instance)(rate(coreops_http_requests_total{{job={api},transport="http"}}[5m]))'
    errors = f'sum by(job,instance)(rate(coreops_http_requests_total{{job={api},transport="http",code=~"5.."}}[5m]))'
    min_rps = number(env, 'ALERT_MIN_RPS', 1, 0.01, 1000000)
    p95 = f'histogram_quantile(0.95,sum by(job,instance,le)(rate(coreops_http_request_duration_seconds_bucket{{job={api},transport="http"}}[5m])))'
    specs = [
        ('TargetDown', 'up == 0', '2m', 'target', 'critical', 'Prometheus cannot scrape this target.', 'Check exporter health, network, scrape authentication and TLS. A failed scrape alone does not prove the application is unavailable.'),
        ('HostCPUHigh', f'100 * (1 - avg by(job,instance)(rate(node_cpu_seconds_total{{job={node},mode="idle"}}[5m]))) > {number(env,"ALERT_CPU_PERCENT",85)}', '10m', 'host', 'warning', 'Host CPU has remained above the configured threshold.', 'Compare CPU with workload and process activity; sustained usage is evidence, the root cause still requires investigation.'),
        ('HostMemoryLow', f'100 * node_memory_MemAvailable_bytes{n} / node_memory_MemTotal_bytes{n} < {number(env,"ALERT_MEMORY_AVAILABLE_PERCENT",10)}', '5m', 'host', 'warning', 'Available host memory is below the configured threshold.', 'Check MemAvailable, process RSS, workload limits and OOM events before diagnosing a memory leak.'),
        ('HostDiskLow', f'(100 * node_filesystem_avail_bytes{fs} / node_filesystem_size_bytes{fs} < {number(env,"ALERT_DISK_AVAILABLE_PERCENT",10)}) and on(job,instance,device,mountpoint) (node_filesystem_readonly{fs} == 0)', '10m', 'host', 'critical', 'Available filesystem space is below the configured threshold.', 'Inspect the affected mountpoint, growth and retention. Do not delete application data without checking ownership and backups.'),
        ('CoreOpsHTTP5xxHigh', f'(100 * {errors} / {traffic} > {number(env,"ALERT_HTTP_5XX_PERCENT",5)}) and on(job,instance) ({traffic} >= {min_rps})', '5m', 'coreops', 'critical', 'CoreOps HTTP 5xx ratio is elevated with sufficient traffic.', 'Compare normalized routes, backend logs and dependencies. Failed scrapes and WebSockets are excluded from this ratio.'),
        ('CoreOpsLatencyHigh', f'({p95} > {number(env,"ALERT_P95_SECONDS",0.5,0.001,3600)}) and on(job,instance) ({traffic} >= {min_rps})', '5m', 'coreops', 'warning', 'CoreOps p95 latency is elevated with sufficient traffic.', 'Compare request volume, route patterns, process memory and goroutines. A quantile estimates latency from histogram buckets.'),
    ]
    result = []
    for name, expr, delay, kind, severity, desc, check in specs:
        key = {"TargetDown":"TARGET_DOWN", "HostCPUHigh":"HOST_CPU_HIGH", "HostMemoryLow":"HOST_MEMORY_LOW", "HostDiskLow":"HOST_DISK_LOW", "CoreOpsHTTP5xxHigh":"COREOPS_HTTP_5XX_HIGH", "CoreOpsLatencyHigh":"COREOPS_LATENCY_HIGH"}[name]
        result.append({'alert': name, 'expr': expr, 'for': duration(env, f'ALERT_{key}_FOR', delay), 'labels': {'severity':severity,'coreops_resource':kind}, 'annotations':{'summary':name+' on {{ $labels.instance }}', 'description':desc,'check':check}})
    return {'groups':[{'name':'coreops','interval':'15s','rules':result}]}

def configuration(env):
    api = env.get('COREOPS_SCRAPE_TARGET','127.0.0.1:8082')
    node = env.get('COREOPS_NODE_TARGET','127.0.0.1:19100')
    for target in (api,node):
        if not re.fullmatch(r'[a-zA-Z0-9_.:\[\]-]+:[0-9]{1,5}',target):
            raise ValueError('Scrape targets must be host:port without URL credentials or paths')
    return {'global':{'scrape_interval':'15s','scrape_timeout':'10s','evaluation_interval':'15s'},'rule_files':['/etc/prometheus/rules.json'],'scrape_configs':[
        {'job_name':env.get('COREOPS_PROMETHEUS_API_JOB','coreops-api'),'metrics_path':'/metrics','authorization':{'type':'Bearer','credentials_file':'/run/secrets/metrics-token'},'static_configs':[{'targets':[api]}]},
        {'job_name':env.get('COREOPS_PROMETHEUS_NODE_JOB','coreops-host'),'static_configs':[{'targets':[node]}]},
        {'job_name':'coreops-test','file_sd_configs':[{'files':['/etc/prometheus/test-targets.json'],'refresh_interval':'5s'}]},
    ]}

def write(path, value, mode=0o640):
    tmp = path.with_name(path.name+'.tmp')
    fd = os.open(tmp, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, mode)
    os.fchmod(fd, mode)
    with os.fdopen(fd,'w') as f:
        f.write(value)
    os.replace(tmp,path)

def main():
    env = os.environ
    # Validate before creating files. Never regenerate credentials on subsequent runs.
    config, alert_rules = configuration(env), rules(env)
    public = env.get('GRAFANA_PUBLIC_URL','http://localhost:13000')
    if not re.fullmatch(r'https?://[a-zA-Z0-9_.:\[\]/-]+',public):
        raise ValueError('GRAFANA_PUBLIC_URL must be a credential-free HTTP(S) URL')
    generated = ROOT/'generated'
    generated.mkdir(mode=0o700, exist_ok=True)
    os.chmod(generated,0o700)
    config_dir = generated/'config'
    config_dir.mkdir(mode=0o750,exist_ok=True)
    os.chmod(config_dir,0o750)
    for name in ('metrics-token','grafana-password'):
        if not (generated/name).exists():
            write(generated/name,secrets.token_urlsafe(36)+'\n')
    write(config_dir/'prometheus.json',json.dumps(config,indent=2)+'\n')
    write(config_dir/'rules.json',json.dumps(alert_rules,indent=2)+'\n')
    if not (config_dir/'test-targets.json').exists():
        write(config_dir/'test-targets.json','[]\n')
    write(ROOT/'.env', f'COREOPS_SECRET_GID={os.getgid()}\nGRAFANA_PUBLIC_URL={public}\n',0o600)
    write(generated/'coreops.env', f'COREOPS_METRICS_TOKEN_FILE={generated}/metrics-token\nCOREOPS_PROMETHEUS_URL=http://127.0.0.1:19090\nCOREOPS_GRAFANA_URL=http://127.0.0.1:13000\nCOREOPS_GRAFANA_PUBLIC_URL={public}\nCOREOPS_PROMETHEUS_NODE_JOB={env.get("COREOPS_PROMETHEUS_NODE_JOB","coreops-host")}\nCOREOPS_PROMETHEUS_API_JOB={env.get("COREOPS_PROMETHEUS_API_JOB","coreops-api")}\n',0o600)
    print('Rendered private generated/ configuration. Apply generated/coreops.env to CoreOps; docker compose up -d. Credentials were not printed.')

if __name__ == '__main__':
    main()
