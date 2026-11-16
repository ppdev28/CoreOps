export type Kind = "all" | "host" | "coreops";
export type Tab =
  | "overview"
  | "infrastructure"
  | "services"
  | "alerts"
  | "integrations";
export type TimeWindow = { from: number; to: number; step: number };
export type Context = {
  tab: Tab;
  resource: Kind;
  job: string;
  instance: string;
  range: "15m" | "1h" | "6h" | "24h" | "custom";
  from: number;
  to: number;
  refresh: number;
  paused: boolean;
};
export type Series = {
  labels: Record<string, string>;
  points: { time: number; value: number | null }[];
};
export type Query = { series: Series[]; warnings: string[] };
export type ChartResult = {
  metric: {
    id: string;
    kind: string;
    name: string;
    unit: string;
    description: string;
    expression: string;
  };
  data: Query;
  error?: string;
};
export type Charts = {
  window: TimeWindow;
  results: ChartResult[];
  queriedAt: string;
};
export type Target = {
  id: string;
  kind: string;
  job: string;
  instance: string;
  health: string;
  lastScrape: string;
  lastError: string;
  scrapeDuration: number;
  scrapeInterval: string;
};
export type Resource = {
  id: string;
  kind: string;
  name: string;
  job: string;
  instance: string;
  health: string;
  lastScrape: string;
  lastCollected: number | null;
  metrics: Record<string, number | null>;
};
export type Alert = {
  name: string;
  state: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  activeAt: string;
  value: number | null;
  expression: string;
  duration: number;
  health: string;
  lastError: string;
};
export type Rule = Omit<Alert, "activeAt" | "value"> & { alerts: Alert[] };
export type Overview = {
  summary: {
    targetsUp: number;
    targetsTotal: number;
    pending: number;
    firing: number;
    hostCount: number;
    cpu: number | null;
    memory: number | null;
    rps: number | null;
    errors: number | null;
    p95: number | null;
    trafficState: string;
  };
  targets: Target[];
  resources: Resource[];
  rules: Rule[];
  alerts: Alert[];
  metrics: Record<string, Query>;
  errors: Record<string, string>;
  queriedAt: string;
};
export type Source = {
  configured: boolean;
  healthy: boolean;
  endpoint: string;
  publicUrl?: string;
  error?: string;
  version?: string;
};
export type Integrations = { prometheus: Source; grafana: Source };
export function format(value: number | null | undefined, unit = ""): string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  if (unit === "B" || unit === "B/s") {
    const i = Math.min(
      4,
      Math.max(0, Math.floor(Math.log(Math.max(value, 1)) / Math.log(1024))),
    );
    return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][i]}${unit === "B/s" ? "/s" : ""}`;
  }
  if (unit === "s" && value < 1) return `${(value * 1000).toFixed(1)} ms`;
  if (unit === "uptime") return `${(value / 86400).toFixed(1)} days`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
}
export function alertKey(a: Alert) {
  return a.name + JSON.stringify(Object.entries(a.labels).sort());
}
export function seriesName(s: Series, i: number) {
  return s.labels.route
    ? `${s.labels.method} ${s.labels.route}`
    : s.labels.mountpoint ||
        s.labels.device ||
        s.labels.instance ||
        `Series ${i + 1}`;
}
export function timeWindow(c: Context, now = Date.now()): TimeWindow {
  const to = c.range === "custom" ? c.to : Math.floor(now / 1000);
  const from =
    c.range === "custom"
      ? c.from
      : to - { "15m": 900, "1h": 3600, "6h": 21600, "24h": 86400 }[c.range];
  return { from, to, step: Math.max(15, Math.ceil((to - from) / 600 / 5) * 5) };
}
