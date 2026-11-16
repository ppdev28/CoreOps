import { useEffect, useState } from "react";
import { request } from "../shared/api/client";
export interface HostHistoryPoint {
  time: number;
  cpu: number | null;
  memory: number | null;
  intervalMs?: number;
}
export interface HostHistory {
  source: "sysstat";
  range: string;
  from: number;
  to: number;
  samples: HostHistoryPoint[];
  warnings: string[];
}
export const historyRanges = {
  "5m": 300000,
  "15m": 900000,
  "30m": 1800000,
  "1h": 3600000,
  "6h": 21600000,
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
} as const;
export type HostHistoryRange = keyof typeof historyRanges;
export function useHostHistory(
  range: HostHistoryRange,
  refreshAt: number | null,
  autoRefresh: boolean,
) {
  const [recorded, setRecorded] = useState<HostHistory | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const data = await request<HostHistory>(
          `/monitoring/history?range=${range}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!controller.signal.aborted) {
          setRecorded(data);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Recorded history could not be read",
          );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          if (autoRefresh) timer = setTimeout(() => void read(), 60000);
        }
      }
    };
    setLoading(true);
    setError("");
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [range, refreshAt, autoRefresh]);
  return {
    recorded: recorded?.range === range ? recorded : null,
    error,
    loading,
  };
}
export function mergeHostHistory(
  recorded: HostHistoryPoint[],
  live: HostHistoryPoint[],
  from: number,
  to: number,
) {
  const unique = new Map<number, HostHistoryPoint>();
  for (const p of [...recorded, ...live])
    if (p.time >= from && p.time <= to) unique.set(p.time, p);
  return [...unique.values()].sort((a, b) => a.time - b.time);
}
