import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  RefreshCw,
  Activity,
  Cpu,
  MemoryStick,
  Gauge,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { T } from "../lib/tokens";
import {
  Card,
  CardHeader,
  Btn,
  FilterToggle,
  Skeleton,
  ErrorState,
} from "../components/ui";
import { getMonitoring } from "../lib/api";
import { loadWebSettings, subscribeWebSettings } from "../lib/webSettings";
import type { MonitoringOverview } from "../lib/monitoring";

const RANGES = ["15m", "1h", "6h", "24h", "7d", "30d"] as const;
type Range = (typeof RANGES)[number];
type Source = "system" | "containers";
type Sample = MonitoringOverview & { receivedAt: number };
const RANGE_MS: Record<Range, number> = {
  "15m": 900000,
  "1h": 3600000,
  "6h": 21600000,
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
};
function bytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
function rate(n: number) {
  return `${bytes(Math.max(0, n))}/s`;
}
function deltaRate(
  a: Sample | undefined,
  b: Sample | undefined,
  key: "netRxBytes" | "netTxBytes" | "diskReadBytes" | "diskWriteBytes",
) {
  if (!a || !b || a.timestamp <= b.timestamp) return 0;
  return (
    Math.max(0, a.host[key] - b.host[key]) /
    ((a.timestamp - b.timestamp) / 1000)
  );
}
function MiniTile({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
}) {
  return (
    <Card style={{ padding: "14px 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          color: T.textDim,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: 7,
        }}
      >
        {icon}
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: T.text,
          fontFamily: "JetBrains Mono,monospace",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: T.textDim,
          marginTop: 5,
          fontFamily: "JetBrains Mono,monospace",
        }}
      >
        {sub}
      </div>
    </Card>
  );
}
function MetricChart({
  label,
  color,
  unit,
  data,
  range,
  onRangeChange,
  formatter,
}: {
  label: string;
  color: string;
  unit: string;
  data: { t: number; value: number }[];
  range: Range;
  onRangeChange: (r: Range) => void;
  formatter?: (v: number) => string;
}) {
  return (
    <Card>
      <div
        style={{
          padding: "12px 16px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
          {label}
        </span>
        <div
          style={{
            display: "flex",
            background: T.bg,
            border: `1px solid ${T.border}`,
            borderRadius: 5,
            overflow: "hidden",
          }}
        >
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              style={{
                padding: "3px 8px",
                background: range === r ? T.active : "none",
                border: "none",
                cursor: "pointer",
                fontSize: 10,
                fontWeight: 600,
                color: range === r ? T.text : T.textDim,
                fontFamily: "JetBrains Mono,monospace",
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div style={{ height: 150, padding: "0 8px 10px 0" }}>
        {data.length < 2 ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              color: T.textDim,
            }}
          >
            Collecting samples…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 10, bottom: 0, left: 8 }}
            >
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  background: T.overlay,
                  border: `1px solid ${T.borderStrong}`,
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: "JetBrains Mono,monospace",
                }}
                formatter={(v) => {
                  const value = Number(v);
                  return [
                    `${formatter ? formatter(value) : value.toFixed(1)}${unit}`,
                    "",
                  ];
                }}
                labelFormatter={(v) =>
                  new Date(Number(v)).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                }
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.7}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

export default function MonitoringView() {
  const [source, setSource] = useState<Source>("system"),
    [range, setRange] = useState<Range>("1h"),
    [samples, setSamples] = useState<Sample[]>([]),
    [current, setCurrent] = useState<MonitoringOverview | null>(null),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState<string | null>(null),
    [settings, setSettings] = useState(loadWebSettings);
  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const next = await getMonitoring();
      const receivedAt = Date.now();
      setCurrent(next);
      setSamples((p) => [...p, { ...next, receivedAt }].slice(-1200));
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load monitoring data",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => subscribeWebSettings(setSettings), []);
  useEffect(() => {
    void load(true);
  }, [load]);
  useEffect(() => {
    if (!settings.autoRefresh) return;
    const timer = window.setInterval(
      () => void load(false),
      settings.refreshSeconds * 1000,
    );
    return () => window.clearInterval(timer);
  }, [load, settings.autoRefresh, settings.refreshSeconds]);
  const visible = useMemo(() => {
    const cutoff = Date.now() - RANGE_MS[range];
    return samples.filter((s) => s.receivedAt >= cutoff);
  }, [samples, range]);
  const chart = useMemo(
    () =>
      visible.map((s, i) => {
        const p = visible[i - 1];
        return {
          t: s.timestamp,
          cpu: s.host.cpuUsagePercent,
          memory: s.host.memoryUsagePercent,
          diskRead: deltaRate(s, p, "diskReadBytes") / 1048576,
          netRx: deltaRate(s, p, "netRxBytes") / 1048576,
        };
      }),
    [visible],
  );
  if (loading)
    return (
      <div style={{ padding: "22px 24px" }}>
        <Skeleton w={110} h={20} />
        <Skeleton w={280} h={12} />
        <div style={{ height: 14 }} />
        <div
          data-layout="summary"
          data-columns="4"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 10,
          }}
        >
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} h={91} r={10} />
          ))}
        </div>
      </div>
    );
  if (error && !current)
    return (
      <ErrorState
        title="Monitoring unavailable"
        sub={error}
        onRetry={() => void load(true)}
      />
    );
  if (!current) return null;
  const h = current.host,
    p = samples.length > 1 ? samples[samples.length - 2] : undefined,
    now = { ...current, receivedAt: Date.now() };
  const netRx = deltaRate(now, p, "netRxBytes"),
    netTx = deltaRate(now, p, "netTxBytes"),
    diskRead = deltaRate(now, p, "diskReadBytes"),
    diskWrite = deltaRate(now, p, "diskWriteBytes");
  const topCpu = [...current.containers]
      .sort((a, b) => b.cpuPercent - a.cpuPercent)
      .slice(0, 5),
    topMem = [...current.containers]
      .sort((a, b) => b.memoryUsedBytes - a.memoryUsedBytes)
      .slice(0, 5);
  const totalMem = current.containers.reduce(
    (n, c) => n + c.memoryUsedBytes,
    0,
  );
  return (
    <div style={{ padding: "22px 24px", maxWidth: 1400, width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 18,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: T.text }}>
            Monitoring
          </h1>
          <p style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
            Live system and container metrics · refresh preference:{" "}
            {settings.autoRefresh ? `${settings.refreshSeconds}s` : "manual"}.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 10,
              color: T.textDim,
              fontFamily: "JetBrains Mono,monospace",
            }}
          >
            Updated {new Date(current.timestamp).toLocaleTimeString()}
          </span>
          <Btn
            onClick={() => void load(false)}
            disabled={refreshing}
            icon={<RefreshCw size={12} />}
          >
            Refresh
          </Btn>
          <FilterToggle
            options={[
              { label: "System", value: "system" },
              { label: "Containers", value: "containers" },
            ]}
            value={source}
            onChange={setSource}
          />
        </div>
      </div>
      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            border: `1px solid ${T.yellow}35`,
            background: `${T.yellow}0d`,
            borderRadius: 7,
            fontSize: 11,
            color: T.yellow,
          }}
        >
          Live update failed: {error}
        </div>
      )}
      {source === "system" ? (
        <>
          <div
            data-layout="summary"
            data-columns="4"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <MiniTile
              label="CPU"
              value={`${h.cpuUsagePercent.toFixed(1)}%`}
              sub={`${h.cores} cores · load ${h.load1.toFixed(2)}`}
              icon={<Cpu size={12} />}
            />
            <MiniTile
              label="Memory"
              value={`${h.memoryUsagePercent.toFixed(1)}%`}
              sub={`${bytes(h.memoryUsedBytes)} / ${bytes(h.memoryTotalBytes)}`}
              icon={<MemoryStick size={12} />}
            />
            <MiniTile
              label="Swap"
              value={
                h.swapTotalBytes
                  ? `${((h.swapUsedBytes * 100) / h.swapTotalBytes).toFixed(1)}%`
                  : "0%"
              }
              sub={`${bytes(h.swapUsedBytes)} / ${bytes(h.swapTotalBytes)}`}
              icon={<Gauge size={12} />}
            />
            <MiniTile
              label="Load"
              value={h.load1.toFixed(2)}
              sub={`5m ${h.load5.toFixed(2)} · 15m ${h.load15.toFixed(2)}`}
              icon={<Activity size={12} />}
            />
          </div>
          <div
            data-layout="summary"
            data-columns="4"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <MiniTile
              label="Disk Read"
              value={rate(diskRead)}
              sub="host block devices"
              icon={<ArrowDown size={12} />}
            />
            <MiniTile
              label="Disk Write"
              value={rate(diskWrite)}
              sub="host block devices"
              icon={<ArrowUp size={12} />}
            />
            <MiniTile
              label="Net RX"
              value={rate(netRx)}
              sub="host interfaces"
              icon={<ArrowDown size={12} />}
            />
            <MiniTile
              label="Net TX"
              value={rate(netTx)}
              sub="host interfaces"
              icon={<ArrowUp size={12} />}
            />
          </div>
          <div
            data-layout="content"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <MetricChart
              label="CPU Usage"
              color={T.accent}
              unit="%"
              data={chart.map((d) => ({ t: d.t, value: d.cpu }))}
              range={range}
              onRangeChange={setRange}
            />
            <MetricChart
              label="Memory Usage"
              color="#a78bfa"
              unit="%"
              data={chart.map((d) => ({ t: d.t, value: d.memory }))}
              range={range}
              onRangeChange={setRange}
            />
            <MetricChart
              label="Disk I/O Read"
              color={T.yellow}
              unit=" MB/s"
              data={chart.map((d) => ({ t: d.t, value: d.diskRead }))}
              range={range}
              onRangeChange={setRange}
            />
            <MetricChart
              label="Network RX"
              color={T.green}
              unit=" MB/s"
              data={chart.map((d) => ({ t: d.t, value: d.netRx }))}
              range={range}
              onRangeChange={setRange}
            />
          </div>
        </>
      ) : (
        <div
          data-layout="content"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
        >
          <Card>
            <CardHeader
              title="Highest CPU usage"
              sub={`${current.containers.length} running containers`}
            />
            {topCpu.length ? (
              topCpu.map((c, i) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "9px 16px",
                    borderBottom:
                      i < topCpu.length - 1
                        ? `1px solid ${T.borderMuted}`
                        : "none",
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: T.overlay,
                      border: `1px solid ${T.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      color: T.textDim,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      fontWeight: 600,
                      color: T.text,
                      fontFamily: "JetBrains Mono,monospace",
                    }}
                  >
                    {c.name}
                  </span>
                  <div
                    style={{
                      flex: 2,
                      height: 4,
                      background: T.bg,
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, c.cpuPercent)}%`,
                        background: T.accent,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      width: 48,
                      textAlign: "right",
                      fontSize: 12,
                      color: T.textSub,
                      fontFamily: "JetBrains Mono,monospace",
                    }}
                  >
                    {c.cpuPercent.toFixed(1)}%
                  </span>
                </div>
              ))
            ) : (
              <div style={{ padding: 24, fontSize: 12, color: T.textDim }}>
                No running containers.
              </div>
            )}
          </Card>
          <Card>
            <CardHeader
              title="Highest Memory usage"
              sub={`Aggregate ${bytes(totalMem)}`}
            />
            {topMem.length ? (
              topMem.map((c, i) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "9px 16px",
                    borderBottom:
                      i < topMem.length - 1
                        ? `1px solid ${T.borderMuted}`
                        : "none",
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: T.overlay,
                      border: `1px solid ${T.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      color: T.textDim,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      fontWeight: 600,
                      color: T.text,
                      fontFamily: "JetBrains Mono,monospace",
                    }}
                  >
                    {c.name}
                  </span>
                  <div
                    style={{
                      flex: 2,
                      height: 4,
                      background: T.bg,
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, c.memoryPercent)}%`,
                        background: T.purple,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      width: 82,
                      textAlign: "right",
                      fontSize: 12,
                      color: T.textSub,
                      fontFamily: "JetBrains Mono,monospace",
                    }}
                  >
                    {bytes(c.memoryUsedBytes)}
                  </span>
                </div>
              ))
            ) : (
              <div style={{ padding: 24, fontSize: 12, color: T.textDim }}>
                No running containers.
              </div>
            )}
          </Card>
          <div
            data-layout="content"
            style={{
              gridColumn: "1/-1",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <MetricChart
              label="Container CPU"
              color={T.accent}
              unit="%"
              data={visible.map((s) => ({
                t: s.timestamp,
                value: s.containers.reduce((n, c) => n + c.cpuPercent, 0),
              }))}
              range={range}
              onRangeChange={setRange}
            />
            <MetricChart
              label="Container Memory"
              color="#a78bfa"
              unit=" MB"
              data={visible.map((s) => ({
                t: s.timestamp,
                value:
                  s.containers.reduce((n, c) => n + c.memoryUsedBytes, 0) /
                  1048576,
              }))}
              range={range}
              onRangeChange={setRange}
              formatter={(v) => v.toFixed(0)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
