import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  Cpu,
  HardDrive,
  MemoryStick,
  Plus,
  RefreshCw,
  ScrollText,
  Terminal,
  Wifi,
} from "lucide-react";
import {
  getContainers,
  getHost,
  getLogs,
  getMonitoring,
  getNetwork,
  getStorage,
  getUpdates,
} from "../lib/api";
import { getSession } from "../lib/auth";
import { loadWebSettings, subscribeWebSettings } from "../lib/webSettings";
import type {
  Container,
  HostOverview,
  NetworkOverview,
  StorageOverview,
  ToastType,
  UpdatePackage,
  View,
  LogEntry,
} from "../lib/types";
import type { MonitoringOverview } from "../lib/monitoring";
import { dashboardColors as T } from "../lib/dashboard-theme";
import { Button as Btn } from "../components/ui/button";
import {
  Card,
  CardHeader,
  MetricCard,
  ResourceChart,
  SystemInfo,
  ContainersOverview,
  HealthStatus,
  ActivityItem,
  QuickAction,
  bytes,
  type Issue,
  type HistoryPoint,
} from "../components/dashboard";
const uptime = (seconds: number) =>
  `${Math.floor(seconds / 86400)}d ${String(Math.floor((seconds % 86400) / 3600)).padStart(2, "0")}h`;

export default function DashboardView({
  onNavigate,
  onDetail,
}: {
  onNavigate: (view: View) => void;
  onDetail: (id: string) => void;
  addToast: (message: string, type: ToastType) => void;
}) {
  const [host, setHost] = useState<HostOverview | null>(null);
  const [hostSampleAt, setHostSampleAt] = useState<number | null>(null);
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [monitoring, setMonitoring] = useState<MonitoringOverview | null>(null);
  const [storage, setStorage] = useState<StorageOverview | null>(null);
  const [network, setNetwork] = useState<NetworkOverview | null>(null);
  const [updates, setUpdates] = useState<UpdatePackage[] | null>(null);
  const [activity, setActivity] = useState<LogEntry[] | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [settings, setSettings] = useState(loadWebSettings);
  const [rate, setRate] = useState<{ rx: number; tx: number } | null>(null);
  const lastNetwork = useRef<{
    timestamp: number;
    rx: number;
    tx: number;
  } | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const canInspect = getSession()?.user.role !== "viewer";
  const isAdmin = getSession()?.user.role === "admin";

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      const results = await Promise.allSettled([
        getHost(),
        getContainers(),
        getMonitoring(),
        getStorage(),
        getNetwork(),
        getLogs(),
        getUpdates(),
      ]);
      if (!mounted.current) return;
      const [h, c, m, s, n, l, u] = results;
      const names = [
        "Host",
        "Containers",
        "Monitoring",
        "Storage",
        "Network",
        "Activity",
        "Updates",
      ];
      setErrors(
        results.flatMap((result, i) =>
          result.status === "rejected" ? [names[i]] : [],
        ),
      );
      if (h.status === "fulfilled") {
        setHost(h.value);
        setHostSampleAt(Date.now());
      }
      if (c.status === "fulfilled") setContainers(c.value);
      if (s.status === "fulfilled") setStorage(s.value);
      if (n.status === "fulfilled") setNetwork(n.value);
      if (u.status === "fulfilled") setUpdates(u.value.updates);
      if (l.status === "fulfilled")
        setActivity(
          [...l.value.entries]
            .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
            .slice(0, 5),
        );
      if (m.status === "fulfilled") {
        const { timestamp, host: sample } = m.value;
        const prev = lastNetwork.current;
        if (
          prev &&
          timestamp > prev.timestamp &&
          sample.netRxBytes >= prev.rx &&
          sample.netTxBytes >= prev.tx
        ) {
          const seconds = (timestamp - prev.timestamp) / 1000;
          setRate({
            rx: (sample.netRxBytes - prev.rx) / seconds,
            tx: (sample.netTxBytes - prev.tx) / seconds,
          });
        } else setRate(null);
        lastNetwork.current = {
          timestamp,
          rx: sample.netRxBytes,
          tx: sample.netTxBytes,
        };
        setMonitoring(m.value);
        if (
          Number.isFinite(sample.cpuUsagePercent) &&
          Number.isFinite(sample.memoryUsagePercent)
        ) {
          setHistory((points) =>
            [
              ...points.filter(
                (p) => p.time > timestamp - 86400000 && p.time < timestamp,
              ),
              {
                time: timestamp,
                cpu: sample.cpuUsagePercent,
                memory: sample.memoryUsagePercent,
              },
            ].slice(-17280),
          );
        } else {
          setHistory((points) =>
            [...points, { time: timestamp, cpu: null, memory: null }].slice(
              -17280,
            ),
          );
        }
      } else {
        setHistory((points) =>
          [...points, { time: Date.now(), cpu: null, memory: null }].slice(
            -17280,
          ),
        );
        lastNetwork.current = null;
        setRate(null);
      }
      // Critical resources define freshness; optional endpoints may be denied by role.
      if ([h, c, m, s].every((result) => result.status === "fulfilled"))
        setUpdatedAt(Date.now());
    } finally {
      busy.current = false;
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  useEffect(() => subscribeWebSettings(setSettings), []);
  useEffect(() => {
    if (!settings.autoRefresh) return;
    const timer = window.setInterval(
      () => void refresh(),
      settings.refreshSeconds * 1000,
    );
    return () => window.clearInterval(timer);
  }, [refresh, settings.autoRefresh, settings.refreshSeconds]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stale =
    updatedAt !== null &&
    now - updatedAt > Math.max(15000, settings.refreshSeconds * 2000);
  const issues: Issue[] = [];
  for (const container of containers ?? []) {
    if (
      container.health === "unhealthy" ||
      container.status === "restarting" ||
      container.status === "exited"
    )
      issues.push({
        label: `${container.name} · ${container.health === "unhealthy" ? "unhealthy" : container.status}`,
        view: "containers",
        critical: container.health === "unhealthy",
      });
  }
  if (host && host.cpu.usagePercent >= 90)
    issues.push({ label: "CPU usage above 90%", view: "monitoring" });
  if (host && host.memory.usagePercent >= 90)
    issues.push({ label: "Memory usage above 90%", view: "monitoring" });
  if (storage && storage.usagePercent >= 90)
    issues.push({
      label: "Storage usage above 90%",
      view: "storage",
      critical: true,
    });

  const failed = (name: string) => errors.includes(name);
  const monitoringStale =
    stale ||
    failed("Monitoring") ||
    (monitoring !== null &&
      now - monitoring.timestamp >
        Math.max(15000, settings.refreshSeconds * 2000));
  const unavailable = loading ? "Loading…" : "Unavailable";
  const viewAll = (view: View) => (
    <Btn
      variant="ghost"
      size="sm"
      className="text-action"
      onClick={() => onNavigate(view)}
    >
      View all <ArrowRight size={12} />
    </Btn>
  );

  return (
    <div className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="page-eyebrow">WORKSPACE / OVERVIEW</span>
          <h1>Dashboard</h1>
          <p>Observe, diagnose and operate your infrastructure.</p>
        </div>
        <Btn onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw size={13} className={refreshing ? "is-refreshing" : ""} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Btn>
      </div>
      <HealthStatus
        loading={loading}
        disconnected={!loading && !host}
        partial={
          !host ||
          !containers ||
          !monitoring ||
          !storage ||
          ["Host", "Containers", "Monitoring", "Storage"].some(failed)
        }
        stale={stale}
        issues={issues}
        updatedAt={updatedAt}
        onNavigate={onNavigate}
      />
      {errors.length > 0 && (
        <div className="dashboard-data-notice" role="status">
          {errors.join(", ")} could not be refreshed.{" "}
          {host
            ? "Any retained values are last known data."
            : "Check connection and permissions."}
        </div>
      )}
      <section className="dashboard-metrics" aria-label="Resource metrics">
        <MetricCard
          label="CPU"
          loading={loading && !host}
          stale={stale || failed("Host")}
          value={host ? `${Math.round(host.cpu.usagePercent)}%` : "—"}
          sub={
            host
              ? `${host.cpu.cores} logical CPUs · load ${host.load.load1.toFixed(2)}${failed("Host") ? " · last known" : ""}`
              : unavailable
          }
          icon={<Cpu size={14} />}
          history={history.map((p) => p.cpu).slice(-30)}
        />
        <MetricCard
          label="Memory"
          loading={loading && !host}
          stale={stale || failed("Host")}
          value={host ? `${Math.round(host.memory.usagePercent)}%` : "—"}
          sub={
            host
              ? `${bytes(host.memory.usedBytes)} / ${bytes(host.memory.totalBytes)}${failed("Host") ? " · last known" : ""}`
              : unavailable
          }
          icon={<MemoryStick size={14} />}
          history={history.map((p) => p.memory).slice(-30)}
        />
        <MetricCard
          label="Storage"
          loading={loading && !storage}
          stale={stale || failed("Storage")}
          value={storage ? `${Math.round(storage.usagePercent)}%` : "—"}
          sub={
            storage
              ? `${bytes(storage.usedBytes)} / ${bytes(storage.totalCapacityBytes)}${failed("Storage") ? " · last known" : ""}`
              : unavailable
          }
          icon={<HardDrive size={14} />}
        >
          <div className="resource-meter">
            <span
              style={{
                width: `${Math.max(0, Math.min(100, storage?.usagePercent ?? 0))}%`,
                background:
                  storage && storage.usagePercent >= 90 ? T.red : T.accent,
              }}
            />
          </div>
        </MetricCard>
        <MetricCard
          label="Network"
          loading={loading && !monitoring}
          stale={monitoringStale}
          value={rate ? `↓ ${bytes(rate.rx)}/s` : "—"}
          sub={
            failed("Monitoring")
              ? "Rate unavailable"
              : rate
                ? "Measured between server samples"
                : "Waiting for two real samples"
          }
          icon={<Wifi size={14} />}
        >
          <span className="network-upload">
            <ArrowUp size={12} />
            {rate ? `${bytes(rate.tx)}/s upload` : "Upload unavailable"}
          </span>
        </MetricCard>
      </section>
      <section className="dashboard-chart-grid" aria-label="Resource history">
        <ResourceChart
          title="CPU Usage"
          data={history}
          metric="cpu"
          stale={monitoringStale}
          intervalMs={settings.refreshSeconds * 1000}
        />
        <ResourceChart
          title="Memory Usage"
          data={history}
          metric="memory"
          stale={monitoringStale}
          intervalMs={settings.refreshSeconds * 1000}
        />
      </section>
      <section className="dashboard-detail-grid">
        <ContainersOverview
          containers={containers}
          monitoring={failed("Monitoring") ? undefined : monitoring?.containers}
          loading={loading}
          failed={failed("Containers")}
          onDetail={onDetail}
          canInspect={canInspect}
          onViewAll={() => onNavigate("containers")}
        />

        <Card>
          <CardHeader title="System" action={viewAll("host")} />
          <div className="system-heading">
            <strong>{host?.os.name ?? unavailable}</strong>
            <span>{host?.hostname ?? "—"}</span>
          </div>
          <SystemInfo
            rows={[
              { label: "Architecture", value: host?.os.architecture ?? "—" },
              { label: "Kernel", value: host?.os.kernel ?? "—", mono: true },
              {
                label: "Uptime",
                value: host ? uptime(host.uptimeSeconds) : "—",
              },
              {
                label: "Load average",
                value: host
                  ? `${host.load.load1.toFixed(2)} / ${host.load.load5.toFixed(2)} / ${host.load.load15.toFixed(2)}`
                  : "—",
              },
              { label: "Temperature", value: "Unavailable" },
              {
                label: "Last boot (estimated)",
                value: host
                  ? new Date(
                      (hostSampleAt ?? now) - host.uptimeSeconds * 1000,
                    ).toLocaleString()
                  : "—",
              },
              {
                label: "Host IP",
                value: network?.topology.host ?? "—",
                mono: true,
              },
            ]}
          />
        </Card>
      </section>
      <section className="dashboard-activity-grid">
        <Card>
          <CardHeader
            title="Recent activity"
            sub={
              failed("Activity") && activity
                ? "Last known events · refresh unavailable"
                : "Latest available server logs"
            }
            action={viewAll("logs")}
          />
          {activity?.map((entry, i) => (
            <ActivityItem key={`${entry.timestamp}-${i}`} entry={entry} />
          ))}
          {!activity?.length && (
            <div className="dashboard-empty">
              {activity
                ? "No recent activity"
                : loading
                  ? "Loading…"
                  : "Activity unavailable for this connection or role"}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Quick actions"
            sub="Common operational workflows"
          />
          <div className="dashboard-actions">
            <QuickAction
              label="Create container"
              icon={<Plus size={14} />}
              primary
              disabled
              title="Container creation is not yet implemented"
              onClick={() => {}}
            />
            <QuickAction
              label="Open terminal"
              icon={<Terminal size={14} />}
              disabled={!isAdmin}
              title={!isAdmin ? "Admin role required" : "Open host terminal"}
              onClick={() => onNavigate("terminal")}
            />
            <QuickAction
              label="View logs"
              icon={<ScrollText size={14} />}
              disabled={!canInspect}
              title={
                !canInspect ? "Operator role required" : "View server logs"
              }
              onClick={() => onNavigate("logs")}
            />
            <QuickAction
              label="Check updates"
              icon={<RefreshCw size={14} />}
              onClick={() => onNavigate("updates")}
            />
          </div>
          <div className="dashboard-footer-note">
            {updates
              ? `${updates.length} available update${updates.length === 1 ? "" : "s"}${failed("Updates") ? " · last known" : ""}`
              : "Update status unavailable"}
          </div>
        </Card>
      </section>
    </div>
  );
}
