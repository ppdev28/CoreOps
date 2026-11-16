package observability

import "strconv"

const FilesystemExclude = "tmpfs|devtmpfs|overlay|squashfs|proc|sysfs|cgroup.*|nsfs|autofs|tracefs|debugfs|securityfs|pstore|fusectl|ramfs"
const MountExclude = "^/(dev|proc|sys|run|var/lib/docker|var/lib/containers)($|/).*"
const NetworkExclude = "lo|veth.*|docker.*|br-.*|cni.*|flannel.*|virbr.*|tailscale.*|tun.*|tap.*"

func Catalog(c Config, f Filter) map[string]Metric {
	selector := func(kind string, extra string) string {
		job := c.NodeJob
		if kind == "coreops" {
			job = c.APIJob
		}
		s := "job=" + strconv.Quote(job)
		if f.Job != "" {
			s += ",job=" + strconv.Quote(f.Job)
		}
		if f.Instance != "" {
			s += ",instance=" + strconv.Quote(f.Instance)
		}
		if extra != "" {
			s += "," + extra
		}
		return "{" + s + "}"
	}
	node := selector("host", "")
	fs := selector("host", `fstype!~`+strconv.Quote(FilesystemExclude)+`,mountpoint!~`+strconv.Quote(MountExclude))
	nic := selector("host", `device!~`+strconv.Quote(NetworkExclude))
	api := selector("coreops", `transport="http"`)
	traffic := "sum(rate(coreops_http_requests_total" + api + "[5m]))"
	byTraffic := "sum by(job,instance)(rate(coreops_http_requests_total" + api + "[5m]))"
	errors := "sum(rate(coreops_http_requests_total" + selector("coreops", `transport="http",code=~"5.."`) + "[5m]))"
	// Keep zero errors meaningful when counters exist but no 5xx series has ever
	// been created. Zero traffic still yields NaN, normalized to unavailable.
	errorNumerator := "(" + errors + " or (0 * " + traffic + "))"
	fsPercent := "100 * (1 - node_filesystem_avail_bytes" + fs + " / node_filesystem_size_bytes" + fs + ") and on(job,instance,device,mountpoint) (node_filesystem_readonly" + fs + " == 0)"
	m := map[string]Metric{}
	add := func(id, kind, name, unit, description, expr string) {
		m[id] = Metric{ID: id, Kind: kind, Name: name, Unit: unit, Description: description, Expression: expr}
	}
	add("host_cpu", "host", "CPU", "%", "100 × (1 − mean per-core idle rate over 5m), per host.", "100 * (1 - avg by(job,instance)(rate(node_cpu_seconds_total"+selector("host", `mode="idle"`)+"[5m])))")
	add("host_memory", "host", "Memory used", "%", "100 × (1 − MemAvailable / MemTotal), per host.", "100 * (1 - node_memory_MemAvailable_bytes"+node+" / node_memory_MemTotal_bytes"+node+")")
	add("host_memory_available", "host", "Available memory", "B", "MemAvailable from node_exporter.", "node_memory_MemAvailable_bytes"+node)
	add("host_memory_used", "host", "Used memory", "B", "MemTotal − MemAvailable.", "node_memory_MemTotal_bytes"+node+" - node_memory_MemAvailable_bytes"+node)
	add("host_disk", "host", "Filesystem usage", "%", "100 × (1 − available / size), for each writable non-virtual filesystem.", fsPercent)
	add("host_disk_worst", "host", "Most occupied filesystem", "%", "Maximum filesystem occupancy per host; percentages are never summed.", "max by(job,instance)("+fsPercent+")")
	add("host_rx", "host", "Network received", "B/s", "5m byte rate, excluding virtual/loopback interfaces.", "sum by(job,instance)(rate(node_network_receive_bytes_total"+nic+"[5m]))")
	add("host_tx", "host", "Network sent", "B/s", "5m byte rate, excluding virtual/loopback interfaces.", "sum by(job,instance)(rate(node_network_transmit_bytes_total"+nic+"[5m]))")
	add("host_uptime", "host", "Uptime", "s", "Query time minus the host boot timestamp.", "time() - node_boot_time_seconds"+node)
	add("host_collected_at", "host", "Last collected", "unix_s", "Actual ingestion timestamp of node_uname_info.", "timestamp(node_uname_info"+node+")")
	add("host_info", "host", "Host identity", "info", "nodename from the monitored node exporter.", "node_uname_info"+node)
	add("api_rps", "coreops", "Requests", "req/s", "Sum of 5m per-series request rates; metrics scrapes and websocket lifetime excluded.", traffic)
	add("api_rps_instance", "coreops", "Requests by instance", "req/s", "5m request rate by backend instance.", byTraffic)
	add("api_errors", "coreops", "HTTP 5xx", "%", "100 × 5xx rate / all request rate. No traffic is unavailable, not a zero error guarantee.", "100 * "+errorNumerator+" / "+traffic)
	for _, q := range []struct{ id, name, n string }{{"api_p50", "Latency p50", "0.5"}, {"api_p95", "Latency p95", "0.95"}, {"api_p99", "Latency p99", "0.99"}} {
		add(q.id, "coreops", q.name, "s", "histogram_quantile over 5m bucket rates summed by le across the selected instances.", "histogram_quantile("+q.n+", sum by(le)(rate(coreops_http_request_duration_seconds_bucket"+api+"[5m])))")
	}
	add("api_p95_instance", "coreops", "Latency p95 by instance", "s", "5m histogram quantile grouped by job, instance and le.", "histogram_quantile(0.95,sum by(job,instance,le)(rate(coreops_http_request_duration_seconds_bucket"+api+"[5m])))")
	add("api_inflight", "coreops", "In-flight requests", "requests", "Current HTTP requests; websocket sessions and scrapes excluded.", "sum(coreops_http_requests_in_flight"+selector("coreops", `transport="http"`)+")")
	add("api_memory", "coreops", "Process RSS", "B", "Sum of backend process resident memory bytes.", "sum(process_resident_memory_bytes"+selector("coreops", "")+")")
	add("api_goroutines", "coreops", "Goroutines", "goroutines", "Sum of Go goroutines for selected backend processes.", "sum(go_goroutines"+selector("coreops", "")+")")
	add("api_routes", "coreops", "Top 20 routes", "req/s", "Top 20 normalized route/method rates over 5m; no raw URLs or IDs.", "topk(20,sum by(method,route)(rate(coreops_http_requests_total"+api+"[5m])))")
	return m
}
