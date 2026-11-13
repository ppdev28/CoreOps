import { useCallback, useEffect, useMemo, useState } from "react";
import { HardDrive, Database, RefreshCw, AlertTriangle } from "lucide-react";
import { T } from "../lib/tokens";
import { Card, CardHeader, Btn, Th, Td } from "../components/ui";
import { getStorage } from "../lib/api";
import type { StorageDisk, StorageOverview, StorageVolume } from "../lib/types";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index++;
  }
  const digits = value >= 100 || index === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function usageColor(percent: number) {
  return percent > 85 ? T.red : percent > 70 ? T.yellow : T.accent;
}

function DiskRow({ disk }: { disk: StorageDisk }) {
  const label = disk.device || "Unknown device";
  const capacity =
    disk.capacityBytes > 0 ? formatBytes(disk.capacityBytes) : "—";
  return (
    <div
      style={{
        padding: "14px 16px",
        borderBottom: `1px solid ${T.borderMuted}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <HardDrive size={16} color={T.textDim} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: T.text,
                fontFamily: "JetBrains Mono,monospace",
              }}
            >
              {label}
            </span>
            {disk.model && (
              <span
                style={{
                  fontSize: 11,
                  color: T.textDim,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {disk.model}
              </span>
            )}
            <span
              style={{
                fontSize: 11,
                color: T.textDim,
                marginLeft: "auto",
                fontFamily: "JetBrains Mono,monospace",
              }}
            >
              {capacity}
            </span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            flex: 1,
            height: 6,
            background: T.bg,
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, Math.max(0, disk.usagePercent))}%`,
              background: usageColor(disk.usagePercent),
              borderRadius: 3,
            }}
          />
        </div>
        <span
          style={{
            fontSize: 11,
            color: T.textDim,
            fontFamily: "JetBrains Mono,monospace",
            width: 42,
            textAlign: "right",
          }}
        >
          {disk.usagePercent.toFixed(1)}%
        </span>
      </div>
      <div style={{ display: "flex", gap: 20, marginTop: 8, flexWrap: "wrap" }}>
        {[
          { k: "Filesystem", v: disk.filesystem || "—" },
          { k: "Mount", v: disk.mount || "—" },
          { k: "Used", v: formatBytes(disk.usedBytes) },
          { k: "Available", v: formatBytes(disk.availableBytes) },
          { k: "SMART", v: disk.smart },
        ].map((row) => (
          <div key={row.k}>
            <div
              style={{
                fontSize: 10,
                color: T.textDim,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {row.k}
            </div>
            <div
              style={{
                fontSize: 11,
                color:
                  row.k === "SMART" && row.v === "FAILED" ? T.red : T.textSub,
                fontFamily: "JetBrains Mono,monospace",
                marginTop: 2,
              }}
            >
              {row.v}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VolumeRow({ volume }: { volume: StorageVolume }) {
  const usage =
    volume.sizeBytes > 0 ? (volume.usedBytes / volume.sizeBytes) * 100 : 0;
  return (
    <tr
      style={{ cursor: "default" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = T.hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Td>
        <span
          style={{
            fontWeight: 700,
            color: T.text,
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 12,
          }}
        >
          {volume.name}
        </span>
      </Td>
      <Td dim>{volume.driver}</Td>
      <Td
        mono
        dim
        style={{
          maxWidth: 300,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {volume.mountpoint || "—"}
      </Td>
      <Td mono dim right>
        {formatBytes(volume.sizeBytes)}
      </Td>
      <Td mono dim right>
        {formatBytes(volume.usedBytes)}
      </Td>
      <Td mono dim right>
        {volume.sizeBytes > 0 ? `${usage.toFixed(1)}%` : "—"}
      </Td>
    </tr>
  );
}

export default function StorageView({
  addToast,
}: {
  addToast: (m: string, t: any) => void;
}) {
  const [data, setData] = useState<StorageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (background = false) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        setData(await getStorage());
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unable to load storage information";
        setError(message);
        if (background) addToast(message, "error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [addToast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(
    () => ({
      disks: data?.disks.filter((d) => d.type === "disk").length ?? 0,
      volumes: data?.volumes.length ?? 0,
    }),
    [data],
  );

  return (
    <div style={{ padding: "22px 24px" }}>
      <div
        style={{ display: "flex", alignItems: "flex-start", marginBottom: 18 }}
      >
        <div>
          <h1
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: T.text,
              letterSpacing: "-0.02em",
            }}
          >
            Storage
          </h1>
          <p style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
            Disks, partitions, mounts, and Docker volumes from the host.
          </p>
        </div>
        <Btn
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={12} />}
          disabled={loading || refreshing}
          onClick={() => void load(true)}
          style={{ marginLeft: "auto" }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </Btn>
      </div>

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            marginBottom: 14,
            border: `1px solid ${T.red}35`,
            background: `${T.red}0d`,
            borderRadius: 8,
          }}
        >
          <AlertTriangle size={13} color={T.red} />
          <span style={{ fontSize: 11, color: T.textSub, flex: 1 }}>
            {error}
          </span>
          <Btn size="xs" variant="ghost" onClick={() => void load()}>
            Retry
          </Btn>
        </div>
      )}

      {loading && !data ? (
        <Card style={{ padding: 20 }}>
          <div style={{ color: T.textDim, fontSize: 12 }}>
            Loading storage information…
          </div>
        </Card>
      ) : data ? (
        <>
          <div
            data-layout="summary"
            data-columns="3"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 10,
              marginBottom: 14,
            }}
          >
            {[
              {
                label: "Total capacity",
                value: formatBytes(data.totalCapacityBytes),
                sub: `${stats.disks} physical disk${stats.disks === 1 ? "" : "s"}`,
              },
              {
                label: "Used",
                value: formatBytes(data.usedBytes),
                sub: `${data.usagePercent.toFixed(1)}% of reported capacity`,
              },
              {
                label: "Available",
                value: formatBytes(data.availableBytes),
                sub: `${stats.volumes} Docker volume${stats.volumes === 1 ? "" : "s"}`,
              },
            ].map((metric) => (
              <Card key={metric.label} style={{ padding: "14px 16px" }}>
                <div
                  style={{
                    fontSize: 10,
                    color: T.textDim,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    marginBottom: 5,
                  }}
                >
                  {metric.label}
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: T.text,
                    fontFamily: "JetBrains Mono,monospace",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {metric.value}
                </div>
                <div style={{ fontSize: 11, color: T.textDim, marginTop: 3 }}>
                  {metric.sub}
                </div>
              </Card>
            ))}
          </div>

          <Card style={{ marginBottom: 14 }}>
            <CardHeader title="Disks & filesystems" />
            {data.disks.length ? (
              data.disks.map((disk) => (
                <DiskRow key={`${disk.device}:${disk.mount}`} disk={disk} />
              ))
            ) : (
              <div style={{ padding: 18, fontSize: 12, color: T.textDim }}>
                No block devices reported by lsblk.
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Docker volumes" />
            {data.volumes.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: T.bg }}>
                    <Th>Name</Th>
                    <Th>Driver</Th>
                    <Th mono>Mount point</Th>
                    <Th mono right>
                      Size
                    </Th>
                    <Th mono right>
                      Used
                    </Th>
                    <Th mono right>
                      Usage
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {data.volumes.map((volume) => (
                    <VolumeRow key={volume.name} volume={volume} />
                  ))}
                </tbody>
              </table>
            ) : (
              <div
                style={{
                  padding: 18,
                  fontSize: 12,
                  color: T.textDim,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Database size={13} />
                No Docker volumes found.
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
