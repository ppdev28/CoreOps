import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
} from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from "@tanstack/react-table";
import {
  Card as BaseCard,
  CardHeader as BaseHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

import { Skeleton } from "./ui/skeleton";
import { LineChart, type TooltipProps } from "./tremor/LineChart";
import { SparkLineChart } from "./tremor/SparkChart";
import type {
  Container,
  ContainerStatus,
  HealthStatus as ContainerHealth,
  LogEntry,
  View,
} from "../lib/types";
import type { MonitoringContainer } from "../lib/monitoring";

export type HistoryPoint = {
  time: number;
  cpu: number | null;
  memory: number | null;
};
export type Issue = { label: string; view: View; critical?: boolean };
const ranges = {
  "5m": 5,
  "30m": 30,
  "1h": 60,
  "6h": 360,
  "24h": 1440,
} as const;
export const bytes = (value: number) => {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "0 B";
  const i = Math.max(
    0,
    Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4),
  );
  return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${["B", "KB", "MB", "GB", "TB"][i]}`;
};
export const relativeTime = (time: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  return seconds < 5
    ? "a few seconds ago"
    : seconds < 60
      ? `${seconds}s ago`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m ago`
        : `${Math.floor(seconds / 3600)}h ago`;
};

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <BaseCard className={`mono-card ${className}`}>{children}</BaseCard>;
}
export function CardHeader({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <BaseHeader className="mono-card-header">
      <div>
        <CardTitle>{title}</CardTitle>
        {sub && <CardDescription>{sub}</CardDescription>}
      </div>
      {action}
    </BaseHeader>
  );
}
export function MetricCard({
  label,
  value,
  sub,
  icon,
  history,
  loading,
  stale,
  children,
}: {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  history?: (number | null)[];
  loading?: boolean;
  stale?: boolean;
  children?: ReactNode;
}) {
  const points = history?.map((value, i) => ({ sample: i, value }));
  return (
    <Card className="mono-metric">
      <div className="metric-card">
        <div className="metric-heading">
          <span>
            {icon}
            {label}
          </span>
          {stale && (
            <Badge variant="outline" className="mono-stale">
              Last known
            </Badge>
          )}
        </div>
        <div className="metric-value-row">
          {loading ? (
            <Skeleton className="h-9 w-24" />
          ) : (
            <strong className="metric-value">{value}</strong>
          )}
          {points && points.filter((p) => p.value !== null).length > 1 && (
            <SparkLineChart
              className="mono-spark"
              data={points}
              categories={["value"]}
              index="sample"
              colors={["monochrome"]}
              connectNulls={false}
            />
          )}
        </div>
        {children}
        <span className="metric-caption">{sub}</span>
      </div>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="mono-chart-tooltip">
      <span>{label}</span>
      <strong>
        {typeof payload[0]?.value === "number"
          ? `${payload[0].value.toFixed(1)}%`
          : "Unavailable"}
      </strong>
    </div>
  );
}
export function ResourceChart({
  title,
  data,
  metric,
  stale = false,
  intervalMs,
}: {
  title: string;
  data: HistoryPoint[];
  metric: "cpu" | "memory";
  stale?: boolean;
  intervalMs: number;
}) {
  const [range, setRange] = useState<keyof typeof ranges>("5m");
  const end = data.at(-1)?.time ?? Date.now();
  const start = end - ranges[range] * 60000;
  const points = useMemo(() => {
    const selected = data.filter((p) => p.time >= start);
    const result: { time: string; value: number | null }[] = [];
    let previous: HistoryPoint | undefined;
    for (const p of selected) {
      if (previous && p.time - previous.time > intervalMs * 2.5)
        result.push({
          time: new Date(previous.time + intervalMs).toLocaleTimeString(),
          value: null,
        });
      result.push({
        time: new Date(p.time).toLocaleTimeString(),
        value: p[metric],
      });
      previous = p;
    }
    return result;
  }, [data, metric, start, intervalMs]);
  const last = points.at(-1)?.value;
  const samples = points.filter((p) => p.value !== null).length;
  return (
    <Card className="mono-resource-card">
      <CardHeader
        title={title}
        action={
          <span className="chart-current">
            {stale && <span className="mono-stale-label">Stale · </span>}
            {last != null ? `${last.toFixed(1)}%` : "—"}
          </span>
        }
      />
      <div className="chart-toolbar">
        <ToggleGroup
          type="single"
          value={range}
          onValueChange={(value: string) => {
            if (value) setRange(value as keyof typeof ranges);
          }}
          className="range-control"
          aria-label={`${title} time range`}
        >
          {Object.keys(ranges).map((key) => (
            <ToggleGroupItem value={key} key={key} aria-label={key}>
              {key}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="chart-unit">PERCENT</span>
      </div>
      <div
        className="resource-chart"
        role="img"
        aria-label={`${title}: ${samples} real samples${stale ? ", stale" : ""}`}
        data-missing={points.filter((p) => p.value === null).length}
      >
        {samples ? (
          <LineChart
            className="mono-tremor-chart"
            data={points}
            categories={["value"]}
            index="time"
            colors={["monochrome"]}
            minValue={0}
            maxValue={100}
            valueFormatter={(value) => `${value}%`}
            showLegend={false}
            connectNulls={false}
            customTooltip={ChartTooltip}
            yAxisWidth={42}
            tickGap={45}
          />
        ) : (
          <div className="dashboard-empty">Waiting for real samples</div>
        )}
      </div>
      <div className="chart-footnote">
        <span>Session history · {samples} samples</span>
        <span>Earlier data unavailable</span>
      </div>
    </Card>
  );
}
export function StatusDot({
  tone = "neutral",
}: {
  tone?: "neutral" | "success" | "warning" | "critical";
}) {
  return <span className={`mono-status-dot tone-${tone}`} aria-hidden="true" />;
}
export function StatusBadge({
  status,
  health,
}: {
  status: ContainerStatus;
  health: ContainerHealth;
}) {
  const tone =
    health === "unhealthy" || status === "exited"
      ? "critical"
      : status === "running"
        ? "success"
        : status === "restarting" || status === "paused"
          ? "warning"
          : "neutral";
  const label = status[0].toUpperCase() + status.slice(1);
  return (
    <div className="mono-status-stack">
      <Badge variant="outline" className="mono-status">
        <StatusDot tone={tone} />
        {label}
      </Badge>
      {health !== "none" && (
        <span
          className={`mono-health-label ${health === "unhealthy" ? "text-critical" : ""}`}
        >
          {health === "unhealthy" ? (
            <AlertTriangle size={11} />
          ) : health === "healthy" ? (
            <Check size={11} />
          ) : (
            <LoaderCircle size={11} />
          )}
          {health[0].toUpperCase() + health.slice(1)} health check
        </span>
      )}
    </div>
  );
}
export function HealthStatus({
  loading,
  disconnected,
  stale,
  partial,
  issues,
  updatedAt,
  onNavigate,
}: {
  loading: boolean;
  disconnected: boolean;
  stale: boolean;
  partial: boolean;
  issues: Issue[];
  updatedAt: number | null;
  onNavigate: (view: View) => void;
}) {
  const warning = stale || partial || issues.length > 0;
  const Icon = loading
    ? LoaderCircle
    : disconnected || warning
      ? AlertTriangle
      : CheckCircle2;
  const tone = loading
    ? "neutral"
    : disconnected || issues.some((i) => i.critical)
      ? "critical"
      : warning
        ? "warning"
        : "success";
  return (
    <section
      className={`dashboard-health ${issues.length ? "has-issues" : ""}`}
      aria-live="polite"
    >
      <div className="health-summary">
        <span className={`health-icon tone-${tone}`}>
          <Icon size={18} />
        </span>
        <div>
          <strong>
            {loading
              ? "Checking server health…"
              : disconnected
                ? "Server data unavailable"
                : stale
                  ? "Data is stale · refresh to verify health"
                  : partial
                    ? "Health assessment incomplete"
                    : issues.length
                      ? `${issues.length} issue${issues.length === 1 ? " requires" : "s require"} attention`
                      : "All systems operational"}
          </strong>
          <span>
            {updatedAt
              ? `Updated ${relativeTime(updatedAt)}`
              : "Waiting for server data"}{" "}
            · Resource and container checks
          </span>
        </div>
        <Badge variant="outline" className="health-scope">
          {loading
            ? "Checking"
            : disconnected
              ? "Unavailable"
              : warning
                ? "Needs attention"
                : "Operational"}
        </Badge>
      </div>
      {issues.length > 0 && (
        <div className="health-issues">
          {issues.slice(0, 3).map((issue) => (
            <Button
              variant="outline"
              size="sm"
              key={issue.label}
              onClick={() => onNavigate(issue.view)}
            >
              <StatusDot tone={issue.critical ? "critical" : "warning"} />
              {issue.label}
              <ArrowRight size={12} />
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
export function SystemInfo({
  rows,
}: {
  rows: { label: string; value: string; mono?: boolean }[];
}) {
  return (
    <dl className="system-info">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd className={row.mono ? "font-mono" : undefined} title={row.value}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type OverviewRow = { container: Container; metric?: MonitoringContainer };
export function ContainerRow({
  row,
  onDetail,
  canInspect,
}: {
  row: Row<OverviewRow>;
  onDetail: (id: string) => void;
  canInspect: boolean;
}) {
  return (
    <TableRow
      className="mono-container-row"
      data-container-id={row.original.container.id}
      onDoubleClick={
        canInspect ? () => onDetail(row.original.container.id) : undefined
      }
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell
          key={cell.id}
          data-label={cell.column.columnDef.header as string}
          className={`mono-cell-${cell.column.id}`}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  );
}
export function ContainersOverview({
  containers,
  monitoring,
  loading,
  failed,
  onDetail,
  canInspect,
  onViewAll,
}: {
  containers: Container[] | null;
  monitoring?: MonitoringContainer[];
  loading: boolean;
  failed: boolean;
  onDetail: (id: string) => void;
  canInspect: boolean;
  onViewAll: () => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const data = useMemo(
    () =>
      (containers ?? []).slice(0, 5).map((container) => ({
        container,
        metric: monitoring?.find((m) => m.id === container.id),
      })),
    [containers, monitoring],
  );
  const columns = useMemo<ColumnDef<OverviewRow>[]>(
    () => [
      {
        id: "container",
        header: "Container",
        accessorFn: (row) => row.container.name,
        cell: ({ row }) => (
          <div className="container-identity">
            <button
              disabled={!canInspect}
              onClick={() => onDetail(row.original.container.id)}
              aria-label={`Inspect ${row.original.container.name}`}
            >
              {row.original.container.name}
            </button>
            <span className="font-mono" title={row.original.container.image}>
              {row.original.container.image}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.container.status}
            health={row.original.container.health}
          />
        ),
      },
      {
        id: "cpu",
        header: "CPU",
        accessorFn: (row) => row.metric?.cpuPercent,
        sortUndefined: "last",
        cell: ({ row }) =>
          row.original.metric
            ? `${row.original.metric.cpuPercent.toFixed(1)}%`
            : "—",
      },
      {
        id: "memory",
        header: "Memory",
        accessorFn: (row) => row.metric?.memoryUsedBytes,
        sortUndefined: "last",
        cell: ({ row }) =>
          row.original.metric
            ? bytes(row.original.metric.memoryUsedBytes)
            : "—",
      },
    ],
    [canInspect, onDetail],
  );
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <Card className="mono-containers">
      <CardHeader
        title="Containers"
        sub={
          containers
            ? `${containers.filter((c) => c.status === "running").length} running / ${containers.length} total${failed ? " · Last known data" : ""}`
            : loading
              ? "Loading inventory…"
              : "Inventory unavailable"
        }
        action={
          <Button variant="ghost" size="sm" onClick={onViewAll}>
            View all <ArrowRight size={13} />
          </Button>
        }
      />
      <Table aria-label="Containers overview">
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={`mono-cell-${header.id}`}
                  aria-sort={
                    header.column.getIsSorted() === "asc"
                      ? "ascending"
                      : header.column.getIsSorted() === "desc"
                        ? "descending"
                        : "none"
                  }
                >
                  {header.column.getCanSort() ? (
                    <button
                      className="mono-sort"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {header.column.getIsSorted() === "desc" ? (
                        <ChevronDown size={11} />
                      ) : header.column.getIsSorted() === "asc" ? (
                        <ChevronUp size={11} />
                      ) : null}
                    </button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading && !containers ? (
            <TableRow>
              <TableCell colSpan={4}>
                <Skeleton className="h-28 w-full" />
              </TableCell>
            </TableRow>
          ) : (
            table
              .getRowModel()
              .rows.map((row) => (
                <ContainerRow
                  key={row.id}
                  row={row}
                  onDetail={onDetail}
                  canInspect={canInspect}
                />
              ))
          )}
          {!loading && !data.length && (
            <TableRow>
              <TableCell colSpan={4} className="dashboard-empty">
                {containers
                  ? "No containers found"
                  : "Container inventory unavailable"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
export function ActivityItem({ entry }: { entry: LogEntry }) {
  const timestamp = Date.parse(entry.timestamp);
  const critical = /error|critical/i.test(entry.level);
  const warning = /warn/i.test(entry.level);
  return (
    <div className="activity-item">
      <span
        className={`activity-icon ${critical ? "text-critical" : warning ? "text-warning" : ""}`}
      >
        {critical || warning ? (
          <AlertTriangle size={14} />
        ) : (
          <Activity size={14} />
        )}
      </span>
      <div>
        <p>{entry.message}</p>
        <span>
          {entry.source} · {entry.level}
        </span>
      </div>
      <time dateTime={entry.timestamp} title={entry.timestamp}>
        {Number.isFinite(timestamp) ? relativeTime(timestamp) : entry.timestamp}
      </time>
    </div>
  );
}
export function QuickAction({
  label,
  icon,
  onClick,
  disabled,
  title,
  primary = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
}) {
  return (
    <Button
      variant={primary ? "default" : "secondary"}
      className="mono-quick-action"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {icon}
      {label}
      <ArrowRight size={13} />
    </Button>
  );
}
export { ServerSelector } from "./dashboard/ServerSelector";
