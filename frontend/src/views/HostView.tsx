import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  CheckCircle2,
  Cpu,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server,
  Timer,
} from "lucide-react";
import { T } from "../lib/tokens";
import { getHost } from "../lib/api";
import type { HostOverview } from "../lib/types";
import { Btn, Card, CardHeader } from "../components/ui";

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
}
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400),
    hours = Math.floor((seconds % 86400) / 3600),
    minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
function Progress({
  value,
  dangerAt = 85,
}: {
  value: number;
  dangerAt?: number;
}) {
  const color = value >= dangerAt ? T.red : value >= 70 ? T.yellow : T.accent;
  return (
    <div
      style={{
        height: 5,
        background: T.bg,
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.min(100, Math.max(0, value))}%`,
          background: color,
          borderRadius: 3,
        }}
      />
    </div>
  );
}
function StatCard({
  icon,
  label,
  value,
  detail,
  progress,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  progress?: number;
}) {
  return (
    <Card>
      <div style={{ padding: "14px 16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginBottom: 11,
          }}
        >
          <span style={{ color: T.textDim, display: "flex" }}>{icon}</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: T.textDim,
              textTransform: "uppercase",
              letterSpacing: ".07em",
            }}
          >
            {label}
          </span>
        </div>
        <div
          style={{
            fontSize: 25,
            lineHeight: 1,
            fontWeight: 700,
            color: T.text,
            fontFamily: "JetBrains Mono,monospace",
            marginBottom: 8,
          }}
        >
          {value}
        </div>
        <div
          style={{
            fontSize: 11,
            color: T.textDim,
            fontFamily: "JetBrains Mono,monospace",
            marginBottom: progress == null ? 0 : 9,
          }}
        >
          {detail}
        </div>
        {progress != null && <Progress value={progress} />}
      </div>
    </Card>
  );
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        padding: "9px 14px",
        borderBottom: `1px solid ${T.borderMuted}`,
      }}
    >
      <span style={{ fontSize: 11, color: T.textDim }}>{label}</span>
      <span
        style={{
          fontSize: 11,
          color: T.textSub,
          fontFamily: "JetBrains Mono,monospace",
          textAlign: "right",
        }}
      >
        {value || "—"}
      </span>
    </div>
  );
}
export default function HostView() {
  const [host, setHost] = useState<HostOverview | null>(null),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState<string | null>(null);
  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setHost(await getHost());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load host information",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading && !host)
    return (
      <div
        style={{
          padding: "20px 24px",
          maxWidth: 1400,
          width: "100%",
          color: T.textDim,
          fontSize: 12,
        }}
      >
        Loading host information…
      </div>
    );
  if (error && !host)
    return (
      <div style={{ padding: "20px 24px", maxWidth: 1400, width: "100%" }}>
        <Card>
          <div style={{ padding: 24, textAlign: "center" }}>
            <div style={{ color: T.red, fontSize: 13, marginBottom: 12 }}>
              Could not load host information
            </div>
            <div style={{ color: T.textDim, fontSize: 11, marginBottom: 16 }}>
              {error}
            </div>
            <Btn onClick={() => void load()} icon={<RefreshCw size={12} />}>
              Retry
            </Btn>
          </div>
        </Card>
      </div>
    );
  if (!host) return null;
  return (
    <div style={{ padding: "20px 24px", maxWidth: 1400, width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              marginBottom: 5,
            }}
          >
            <Server size={18} color={T.accent} />
            <h1
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 700,
                color: T.text,
              }}
            >
              Host Overview
            </h1>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px",
                borderRadius: 5,
                background: `${T.green}12`,
                border: `1px solid ${T.green}28`,
                color: T.green,
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              <CheckCircle2 size={11} /> Online
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: T.textDim,
              fontFamily: "JetBrains Mono,monospace",
            }}
          >
            {host.hostname}
          </div>
        </div>
        <Btn
          onClick={() => void load(true)}
          disabled={refreshing}
          icon={<RefreshCw size={12} />}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </Btn>
      </div>
      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: "9px 12px",
            borderRadius: 7,
            border: `1px solid ${T.red}35`,
            background: `${T.red}0d`,
            color: T.red,
            fontSize: 11,
          }}
        >
          {error} — showing the last successful result.
        </div>
      )}
      <div
        className="host-stats"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <StatCard
          icon={<Cpu size={13} />}
          label="CPU"
          value={`${host.cpu.usagePercent.toFixed(1)}%`}
          detail={`${host.cpu.cores} cores`}
          progress={host.cpu.usagePercent}
        />
        <StatCard
          icon={<MemoryStick size={13} />}
          label="Memory"
          value={`${host.memory.usagePercent.toFixed(1)}%`}
          detail={`${formatBytes(host.memory.usedBytes)} / ${formatBytes(host.memory.totalBytes)}`}
          progress={host.memory.usagePercent}
        />
        <StatCard
          icon={<HardDrive size={13} />}
          label="Storage"
          value={`${host.disk.usagePercent.toFixed(1)}%`}
          detail={`${formatBytes(host.disk.usedBytes)} / ${formatBytes(host.disk.totalBytes)}`}
          progress={host.disk.usagePercent}
        />
      </div>
      <div
        className="host-grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
      >
        <Card>
          <CardHeader title="System" />
          <InfoRow label="Hostname" value={host.hostname} />
          <InfoRow
            label="Operating system"
            value={`${host.os.name}${host.os.version ? ` ${host.os.version}` : ""}`}
          />
          <InfoRow label="Kernel" value={host.os.kernel} />
          <InfoRow label="Architecture" value={host.os.architecture} />
          <InfoRow label="Uptime" value={formatUptime(host.uptimeSeconds)} />
        </Card>
        <Card>
          <CardHeader title="Load average" />
          <div style={{ padding: "14px 16px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 8,
              }}
            >
              {[
                ["1 min", host.load.load1],
                ["5 min", host.load.load5],
                ["15 min", host.load.load15],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  style={{
                    padding: "13px 10px",
                    background: T.bg,
                    border: `1px solid ${T.borderMuted}`,
                    borderRadius: 7,
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: 18,
                      color: T.text,
                      fontFamily: "JetBrains Mono,monospace",
                      fontWeight: 650,
                    }}
                  >
                    {Number(value).toFixed(2)}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 10, color: T.textDim }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                marginTop: 13,
                color: T.textDim,
                fontSize: 11,
              }}
            >
              <Activity size={12} /> Values from the Linux load average.
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Memory" />
          <InfoRow label="Total" value={formatBytes(host.memory.totalBytes)} />
          <InfoRow label="Used" value={formatBytes(host.memory.usedBytes)} />
          <InfoRow
            label="Available"
            value={formatBytes(host.memory.availableBytes)}
          />
          <InfoRow
            label="Usage"
            value={`${host.memory.usagePercent.toFixed(1)}%`}
          />
        </Card>
        <Card>
          <CardHeader title="Storage" />
          <InfoRow label="Filesystem" value="/" />
          <InfoRow label="Total" value={formatBytes(host.disk.totalBytes)} />
          <InfoRow label="Used" value={formatBytes(host.disk.usedBytes)} />
          <InfoRow
            label="Available"
            value={formatBytes(host.disk.availableBytes)}
          />
          <InfoRow
            label="Usage"
            value={`${host.disk.usagePercent.toFixed(1)}%`}
          />
        </Card>
        <Card>
          <CardHeader title="Runtime" />
          <div style={{ padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <Timer size={15} color={T.accent} />
              <div>
                <div style={{ fontSize: 12, color: T.text }}>Host uptime</div>
                <div
                  style={{
                    fontSize: 16,
                    color: T.text,
                    fontFamily: "JetBrains Mono,monospace",
                    fontWeight: 650,
                    marginTop: 3,
                  }}
                >
                  {formatUptime(host.uptimeSeconds)}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
      <div style={{ marginTop: 12, fontSize: 10, color: T.textDim }}>
        Storage reports the filesystem containing the CoreOps host root (`/`). CPU
        usage is sampled by the backend when this page is refreshed.
      </div>
    </div>
  );
}
