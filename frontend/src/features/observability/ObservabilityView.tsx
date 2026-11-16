import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  CirclePause,
  Play,
  RefreshCw,
  Server,
  ShieldAlert,
} from "lucide-react";
import { ApiError } from "../../shared/api/client";
import * as api from "./api";
import Chart from "./Chart";
import { useContext } from "./context";
import {
  alertKey,
  format,
  seriesName,
  timeWindow,
  type Alert,
  type Charts,
  type Context,
  type Integrations,
  type Overview,
  type Resource,
  type Target,
  type TimeWindow,
} from "./model";
import "./observability.css";

const TABS = {
  overview: "Overview",
  infrastructure: "Infrastructure",
  services: "Services",
  alerts: "Alerts",
  integrations: "Integrations",
} as const;
const HOST = [
  "host_cpu",
  "host_memory",
  "host_disk",
  "host_rx",
  "host_tx",
  "host_uptime",
];
const SERVICE = [
  "api_rps",
  "api_errors",
  "api_p50",
  "api_p95",
  "api_p99",
  "api_inflight",
  "api_memory",
  "api_goroutines",
  "api_routes",
];
const date = (s?: string | number | null) =>
  s
    ? new Date(typeof s === "number" ? s * 1000 : s).toLocaleString()
    : "Not collected";
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`obs-badge obs-${tone}`}>{children}</span>;
}
function SourceBadge({
  source,
  name,
}: {
  source?: Integrations["prometheus"];
  name: string;
}) {
  return (
    <Badge
      tone={
        !source
          ? "neutral"
          : source.healthy
            ? "ok"
            : source.configured
              ? "bad"
              : "warn"
      }
    >
      {name}:{" "}
      {!source
        ? "Checking…"
        : source.healthy
          ? "Connected"
          : source.configured
            ? "Unavailable"
            : "Not configured"}
    </Badge>
  );
}
function Stat({
  label,
  value,
  help,
  onClick,
}: {
  label: string;
  value: string;
  help: string;
  onClick?: () => void;
}) {
  return (
    <button className="obs-card obs-stat" onClick={onClick} disabled={!onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{help}</small>
    </button>
  );
}
function localDate(t: number) {
  const d = new Date(t * 1000);
  if (!Number.isFinite(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export default function ObservabilityView() {
  const [context, update] = useContext();
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const id = globalThis.setInterval(() => setClock(Date.now()), 15000);
    return () => globalThis.clearInterval(id);
  }, []);
  const [tick, setTick] = useState(0),
    [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<Overview>(),
    [inventory, setInventory] = useState<Target[]>([]),
    [sources, setSources] = useState<Integrations>();
  const [chartData, setChartData] = useState<Charts>(),
    [window, setWindow] = useState<TimeWindow>(() => timeWindow(context));
  const [targetError, setTargetError] = useState("");
  const [error, setError] = useState(""),
    [chartError, setChartError] = useState(""),
    [linkError, setLinkError] = useState("");
  const [selectedAlert, setSelectedAlert] = useState<Alert>();
  const [scope, setScope] = useState("");
  const [fromDraft, setFromDraft] = useState(localDate(context.from)),
    [toDraft, setToDraft] = useState(localDate(context.to));
  useEffect(() => {
    setFromDraft(localDate(context.from));
    setToDraft(localDate(context.to));
  }, [context.from, context.to]);
  useEffect(() => {
    if (context.paused) return;
    const timer = globalThis.setInterval(
      () => setTick((v) => v + 1),
      context.refresh * 1000,
    );
    return () => globalThis.clearInterval(timer);
  }, [context.refresh, context.paused]);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const w = timeWindow(context);
    const currentScope = JSON.stringify([
      context.resource,
      context.job,
      context.instance,
      context.range,
      context.from,
      context.to,
      context.tab,
    ]);
    setLoading(true);
    setError("");
    setChartError("");
    setTargetError("");
    if (currentScope !== scope) {
      setSnapshot(undefined);
      setChartData(undefined);
      setScope(currentScope);
    }
    if (
      w.from <= 0 ||
      w.to <= w.from ||
      w.to - w.from > 30 * 86400 ||
      w.to > Date.now() / 1000 + 60
    ) {
      setError(
        "Choose a valid interval up to 30 days, ending no later than now.",
      );
      setLoading(false);
      return () => controller.abort();
    }
    setWindow(w);
    const ids =
      context.tab === "infrastructure"
        ? HOST
        : context.tab === "services"
          ? SERVICE
          : context.tab === "alerts"
            ? context.resource === "host"
              ? HOST
              : context.resource === "coreops"
                ? SERVICE.slice(0, 8)
                : []
            : context.tab === "integrations"
              ? []
              : [
                  ...(context.resource !== "coreops"
                    ? ["host_cpu", "host_memory"]
                    : []),
                  ...(context.resource !== "host"
                    ? ["api_rps", "api_errors", "api_p95"]
                    : []),
                ];
    const allowed = ids.filter(
      (id) =>
        context.resource === "all" ||
        id.startsWith(context.resource === "host" ? "host_" : "api_"),
    );
    const batches = [allowed.slice(0, 8), allowed.slice(8)].filter(
      (ids) => ids.length,
    );
    void Promise.allSettled([
      api.integrations(signal).then((value) => {
        if (!signal.aborted) setSources(value);
      }),
      api
        .targets(signal)
        .then((value) => {
          if (!signal.aborted) setInventory(value);
        })
        .catch((e) => {
          if (!signal.aborted) setTargetError(e.message);
        }),
      api
        .overview(context, w, signal)
        .then((value) => {
          if (!signal.aborted) setSnapshot(value);
        })
        .catch((e) => {
          if (!signal.aborted)
            setError(
              e instanceof ApiError && e.status === 403
                ? "Permission denied: your CoreOps account cannot read observability."
                : e.message,
            );
        }),
      Promise.all(batches.map((ids) => api.charts(context, w, ids, signal)))
        .then((values) => {
          if (!signal.aborted) {
            const results = values.flatMap((v) => v.results);
            const failures = results.filter((r) => r.error);
            if (failures.length)
              setChartError(
                failures.map((r) => `${r.metric.name}: ${r.error}`).join(" · "),
              );
            setChartData((previous) =>
              failures.length && previous && currentScope === scope
                ? previous
                : {
                    window: w,
                    results,
                    queriedAt: values[0]?.queriedAt || "",
                  },
            );
          }
        })
        .catch((e) => {
          if (!signal.aborted) setChartError(e.message);
        }),
    ]).then(() => {
      if (!signal.aborted) setLoading(false);
    });
    return () => controller.abort();
    // scope tracks retained data; its update must not cause a second request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, tick]);
  const filteredTargets = inventory.filter(
    (t) =>
      (context.resource === "all" || t.kind === context.resource) &&
      (!context.job || t.job === context.job) &&
      (!context.instance || t.instance === context.instance),
  );
  const hosts = snapshot?.resources.filter((r) => r.kind === "host") || [];
  const services =
    snapshot?.resources.filter((r) => r.kind === "coreops") || [];
  const jobs = useMemo(
    () => [
      ...new Set(
        inventory
          .filter(
            (t) => context.resource === "all" || t.kind === context.resource,
          )
          .map((t) => t.job),
      ),
    ],
    [inventory, context.resource],
  );
  const instances = useMemo(
    () => [
      ...new Set(
        inventory
          .filter(
            (t) =>
              (!context.job || t.job === context.job) &&
              (context.resource === "all" || t.kind === context.resource),
          )
          .map((t) => t.instance),
      ),
    ],
    [inventory, context.job, context.resource],
  );
  const zoom = (from: number, to: number) =>
    update({ range: "custom", from, to });
  const selectResource = (r: Pick<Resource, "kind" | "job" | "instance">) =>
    update({
      resource: r.kind === "host" ? "host" : "coreops",
      job: r.job,
      instance: r.instance,
      tab: r.kind === "host" ? "infrastructure" : "services",
    });
  const investigate = (a: Alert) => {
    setSelectedAlert(a);
    const target = inventory.find(
      (t) => t.job === a.labels.job && t.instance === a.labels.instance,
    );
    const to = Math.floor(Date.now() / 1000);
    const active = Math.floor(new Date(a.activeAt).getTime() / 1000);
    update({
      tab: "alerts",
      resource:
        target?.kind === "host"
          ? "host"
          : target?.kind === "coreops"
            ? "coreops"
            : "all",
      job: a.labels.job || "",
      instance: a.labels.instance || "",
      range:
        to - active + 600 <= 900
          ? "15m"
          : to - active + 600 <= 3600
            ? "1h"
            : to - active + 600 <= 21600
              ? "6h"
              : to - active + 600 <= 86400
                ? "24h"
                : "custom",
      from: Math.max(
        to - 30 * 86400,
        Math.min(to - 900, (Number.isFinite(active) ? active : to) - 600),
      ),
      to,
    });
  };
  const openGrafana = async (kind: string) => {
    setLinkError("");
    // Open synchronously so browsers do not block a window after an async request.
    const tab = globalThis.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const link = await api.grafana(context, window, kind);
      if (tab) tab.location.href = link.url;
      else globalThis.location.assign(link.url);
    } catch (e) {
      tab?.close();
      setLinkError(e instanceof Error ? e.message : "Unable to open Grafana");
    }
  };
  const summary = snapshot?.summary;
  const selectedMatches =
    !selectedAlert ||
    ((!context.job || context.job === selectedAlert.labels.job) &&
      (!context.instance ||
        context.instance === selectedAlert.labels.instance) &&
      (context.resource === "all" ||
        context.resource ===
          (inventory.find(
            (t) =>
              t.job === selectedAlert.labels.job &&
              t.instance === selectedAlert.labels.instance,
          )?.kind || selectedAlert.labels.coreops_resource)));
  const selectedRule =
    selectedAlert && snapshot?.rules.find((r) => r.name === selectedAlert.name);
  const selectedEvaluationFailed =
    !!selectedAlert &&
    !!snapshot &&
    (!selectedRule || selectedRule.health !== "ok");
  const selectedActive =
    selectedAlert &&
    snapshot?.alerts.find((a) => alertKey(a) === alertKey(selectedAlert));
  const dataAge = snapshot
    ? Math.max(0, (clock - new Date(snapshot.queriedAt).getTime()) / 1000)
    : 0;
  const stale =
    !!error || !!chartError || dataAge > Math.max(60, context.refresh * 3);
  const metricGrid = (
    <>
      {chartError && (
        <p role="alert" className="obs-error">
          Charts: {chartError}. Previous samples remain visible.
        </p>
      )}
      <div className="obs-charts">
        {chartData?.results.map((result) => (
          <Chart
            key={result.metric.id}
            result={result}
            window={chartData.window}
            loading={loading}
            onZoom={zoom}
          />
        ))}
        {loading && !chartData && (
          <div className="obs-card obs-chart-empty" role="status">
            Loading time series…
          </div>
        )}
      </div>
    </>
  );
  const resourceList = (resources: Resource[]) => (
    <div className="obs-resources">
      {resources.map((r) => (
        <section className="obs-card" key={r.id}>
          <div className="obs-row">
            <button
              className="obs-resource-title"
              onClick={() => selectResource(r)}
            >
              <Server size={16} />
              {r.name}
              <ArrowUpRight size={14} />
            </button>
            <Badge tone={r.health === "up" ? "ok" : "bad"}>
              Scrape {r.health}
            </Badge>
          </div>
          <p>
            {r.job} · {r.instance}
          </p>
          <div className="obs-row obs-values">
            {r.kind === "host" ? (
              <>
                <span>
                  CPU <strong>{format(r.metrics.host_cpu, "%")}</strong>
                </span>
                <span>
                  Memory <strong>{format(r.metrics.host_memory, "%")}</strong>
                </span>
                <span>
                  Worst disk{" "}
                  <strong>{format(r.metrics.host_disk_worst, "%")}</strong>
                </span>
                <span>
                  Uptime{" "}
                  <strong>{format(r.metrics.host_uptime, "uptime")}</strong>
                </span>
              </>
            ) : (
              <>
                <span>
                  Traffic <strong>{format(r.metrics.api_rps, "req/s")}</strong>
                </span>
                <span>
                  p95 <strong>{format(r.metrics.api_p95, "s")}</strong>
                </span>
              </>
            )}
          </div>
          <small>
            Last successful sample:{" "}
            {r.kind === "host" ? date(r.lastCollected) : "See time series"} ·
            Last scrape attempt: {date(r.lastScrape)}
          </small>
        </section>
      ))}
      {!loading && !resources.length && !error && (
        <p className="obs-card">
          No monitored resources match these filters. Check target jobs in
          Integrations.
        </p>
      )}
    </div>
  );
  const alertList = (
    <>
      <div className="obs-row">
        <h2>Active alerts</h2>
        <small>Current Prometheus evaluation · no incident history</small>
      </div>
      {!snapshot && loading ? (
        <p role="status">Loading alert state…</p>
      ) : !snapshot ? (
        <p>Alert state is unknown while Prometheus cannot be queried.</p>
      ) : !snapshot.alerts.length ? (
        <p className="obs-card">
          {error
            ? "Previous snapshot had no active alerts; current state is unknown."
            : "No active alerts match the current filters."}
        </p>
      ) : (
        snapshot.alerts.map((a) => (
          <button
            className="obs-card obs-alert"
            key={alertKey(a)}
            onClick={() => investigate(a)}
          >
            <div className="obs-row">
              <strong>
                <ShieldAlert size={15} /> {a.name}
              </strong>
              <span>
                <Badge tone={a.state === "firing" ? "bad" : "warn"}>
                  {a.state}
                </Badge>{" "}
                <Badge>{a.labels.severity || "unspecified"}</Badge>
              </span>
            </div>
            <p>{a.annotations.summary || a.annotations.description}</p>
            <small>
              {a.labels.job} · {a.labels.instance} {a.labels.mountpoint} ·
              Active since {date(a.activeAt)}
            </small>
            <span className="obs-link">Investigate metrics →</span>
          </button>
        ))
      )}
    </>
  );
  return (
    <div className="obs-view" data-observability>
      <header className="obs-heading">
        <div>
          <h1>
            <Activity size={22} /> Observability
          </h1>
          <p>Host and CoreOps health, metrics and active Prometheus alerts.</p>
        </div>
        <div className="obs-actions">
          <button
            onClick={() =>
              void openGrafana(
                context.resource === "host" || context.tab === "infrastructure"
                  ? "host"
                  : "coreops",
              )
            }
          >
            <ArrowUpRight size={14} /> Open in Grafana
          </button>
          <button onClick={() => setTick((v) => v + 1)} disabled={loading}>
            <RefreshCw size={14} className={loading ? "obs-spin" : ""} />
            {loading ? "Querying…" : "Refresh"}
          </button>
        </div>
      </header>
      <section
        className="obs-card obs-toolbar"
        aria-label="Observability filters"
      >
        <label>
          Time range
          <select
            aria-label="Time range"
            value={context.range}
            onChange={(e) =>
              update({ range: e.target.value as Context["range"] })
            }
          >
            <option value="15m">15 minutes</option>
            <option value="1h">1 hour</option>
            <option value="6h">6 hours</option>
            <option value="24h">24 hours</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          Resource
          <select
            aria-label="Resource"
            value={context.resource}
            onChange={(e) =>
              update({
                resource: e.target.value as Context["resource"],
                job: "",
                instance: "",
              })
            }
          >
            <option value="all">All resources</option>
            <option value="host">Hosts</option>
            <option value="coreops">CoreOps backend</option>
          </select>
        </label>
        <label>
          Job
          <select
            aria-label="Job"
            value={context.job}
            onChange={(e) => update({ job: e.target.value, instance: "" })}
          >
            <option value="">All permitted jobs</option>
            {[...new Set([...jobs, ...(context.job ? [context.job] : [])])].map(
              (j) => (
                <option key={j}>{j}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Instance
          <select
            aria-label="Instance"
            value={context.instance}
            onChange={(e) => update({ instance: e.target.value })}
          >
            <option value="">All instances</option>
            {[
              ...new Set([
                ...instances,
                ...(context.instance ? [context.instance] : []),
              ]),
            ].map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label>
          Auto refresh
          <select
            aria-label="Auto refresh"
            value={context.refresh}
            onChange={(e) => update({ refresh: Number(e.target.value) })}
          >
            {[15, 30, 60, 120].map((s) => (
              <option value={s} key={s}>
                {s} seconds
              </option>
            ))}
          </select>
        </label>
        <button
          aria-pressed={context.paused}
          onClick={() => update({ paused: !context.paused })}
        >
          {context.paused ? <Play size={14} /> : <CirclePause size={14} />}{" "}
          {context.paused ? "Resume" : "Pause"}
        </button>
        {context.range === "custom" && (
          <form
            className="obs-custom"
            onSubmit={(e) => {
              e.preventDefault();
              const from = Math.floor(new Date(fromDraft).getTime() / 1000),
                to = Math.floor(new Date(toDraft).getTime() / 1000);
              if (Number.isFinite(from) && Number.isFinite(to))
                update({ from, to });
            }}
          >
            <label>
              From
              <input
                type="datetime-local"
                aria-label="From"
                value={fromDraft}
                onChange={(e) => setFromDraft(e.target.value)}
                required
              />
            </label>
            <label>
              To
              <input
                type="datetime-local"
                aria-label="To"
                value={toDraft}
                onChange={(e) => setToDraft(e.target.value)}
                required
              />
            </label>
            <button type="submit">Apply interval</button>
          </form>
        )}
      </section>
      <div className="obs-row obs-status" aria-live="polite">
        <span>
          <SourceBadge source={sources?.prometheus} name="Prometheus" />{" "}
          <SourceBadge source={sources?.grafana} name="Grafana" />
        </span>
        <small>
          {loading
            ? "Updating · "
            : stale
              ? "Data may be stale · "
              : context.paused
                ? "Auto refresh paused · "
                : ""}
          Last successful snapshot: {date(snapshot?.queriedAt)} ·{" "}
          {new Date(window.from * 1000).toLocaleString()} –{" "}
          {new Date(window.to * 1000).toLocaleString()}
        </small>
      </div>
      {error && (
        <div role="alert" className="obs-error obs-card">
          {error}
          <p>
            {error.startsWith("Permission")
              ? "Contact your CoreOps administrator."
              : "Check Prometheus configuration, connection and backend source permissions in Integrations. Previous data, if visible, is stale."}
          </p>
        </div>
      )}
      {linkError && (
        <p className="obs-error" role="alert">
          {linkError}
        </p>
      )}
      {snapshot?.rules.some((r) => r.health !== "ok") && (
        <p role="alert" className="obs-warning">
          Prometheus reports rule evaluation errors. Check rule health before
          interpreting active alert counts or recovery.
        </p>
      )}
      {snapshot && Object.keys(snapshot.errors).length > 0 && (
        <p role="alert" className="obs-warning">
          Some indicators could not be queried:{" "}
          {Object.entries(snapshot.errors)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
        </p>
      )}
      <nav className="obs-tabs" aria-label="Observability sections">
        {Object.entries(TABS).map(([key, label]) => (
          <button
            key={key}
            aria-current={context.tab === key ? "page" : undefined}
            onClick={() => update({ tab: key as Context["tab"] })}
          >
            {label}
            {key === "alerts" && summary
              ? ` (${summary.firing + summary.pending})`
              : ""}
          </button>
        ))}
      </nav>
      {context.tab === "overview" && (
        <>
          <div className="obs-stats">
            <Stat
              label="Scrape targets"
              value={
                summary
                  ? `${summary.targetsUp} / ${summary.targetsTotal}`
                  : "Unknown"
              }
              help="Scrape success, not application availability"
              onClick={() => update({ tab: "integrations" })}
            />
            <Stat
              label="Active alerts"
              value={
                summary
                  ? `${summary.firing} firing · ${summary.pending} pending`
                  : "Unknown"
              }
              help="Current Prometheus evaluation"
              onClick={() => update({ tab: "alerts" })}
            />
            <Stat
              label="Host CPU"
              value={format(summary?.cpu, "%")}
              help={
                summary?.hostCount !== 1
                  ? "Select one host instance"
                  : "5m non-idle CPU average"
              }
              onClick={() =>
                update({
                  tab: "infrastructure",
                  resource: "host",
                  job: "",
                  instance: "",
                })
              }
            />
            <Stat
              label="Host memory"
              value={format(summary?.memory, "%")}
              help="Used = total − available"
              onClick={() =>
                update({
                  tab: "infrastructure",
                  resource: "host",
                  job: "",
                  instance: "",
                })
              }
            />
            <Stat
              label="CoreOps traffic"
              value={format(summary?.rps, "req/s")}
              help={
                summary?.trafficState === "idle"
                  ? "No HTTP traffic in the rate window"
                  : summary?.trafficState === "query_error"
                    ? "Query failed"
                    : summary?.trafficState === "no_data"
                      ? "No request samples"
                      : "5m rate · excludes scrapes and WebSockets"
              }
              onClick={() =>
                update({
                  tab: "services",
                  resource: "coreops",
                  job: "",
                  instance: "",
                })
              }
            />
            <Stat
              label="HTTP 5xx"
              value={format(summary?.errors, "%")}
              help="Error ratio · unavailable without traffic"
              onClick={() => update({ tab: "services" })}
            />
            <Stat
              label="Latency p95"
              value={format(summary?.p95, "s")}
              help="5m histogram estimate"
              onClick={() => update({ tab: "services" })}
            />
          </div>
          {metricGrid}
          {alertList}
        </>
      )}
      {context.tab === "infrastructure" && (
        <>
          <div className="obs-row">
            <h2>Monitored hosts</h2>
            <button onClick={() => void openGrafana("host")}>
              Host dashboard <ArrowUpRight size={14} />
            </button>
          </div>
          {context.resource === "coreops" ? (
            <p className="obs-card">
              The resource filter selects CoreOps services.{" "}
              <button
                onClick={() =>
                  update({ resource: "host", job: "", instance: "" })
                }
              >
                Show hosts
              </button>
            </p>
          ) : (
            <>
              {resourceList(hosts)}
              <p>
                Disk is reported per writable filesystem; the card shows the
                most occupied filesystem. Network excludes virtual and loopback
                devices.
              </p>
              {metricGrid}
              {alertList}
            </>
          )}
        </>
      )}
      {context.tab === "services" && (
        <>
          <div className="obs-row">
            <h2>CoreOps backend</h2>
            <button onClick={() => void openGrafana("coreops")}>
              Backend dashboard <ArrowUpRight size={14} />
            </button>
          </div>
          {context.resource === "host" ? (
            <p className="obs-card">
              The resource filter selects hosts.{" "}
              <button
                onClick={() =>
                  update({ resource: "coreops", job: "", instance: "" })
                }
              >
                Show CoreOps
              </button>
            </p>
          ) : (
            <>
              {resourceList(services)}
              <p>
                {summary?.trafficState === "idle"
                  ? "No traffic: request counters exist but their 5m rate is zero. Latency and error ratio have no value."
                  : summary?.trafficState === "no_data"
                    ? "No traffic samples: check scraping and wait for at least two counter samples."
                    : "Percentiles combine histogram buckets across selected instances. All service queries exclude scraping and WebSocket sessions."}
              </p>
              {metricGrid}
              <section className="obs-card">
                <h3>Normalized route traffic</h3>
                <p>Top 20 route/method patterns by measured request rate.</p>
                {chartData?.results
                  .find((r) => r.metric.id === "api_routes")
                  ?.data.series.map((s, i) => (
                    <div className="obs-route" key={i}>
                      <code>{seriesName(s, i)}</code>
                      <strong>{format(s.points.at(-1)?.value, "req/s")}</strong>
                    </div>
                  ))}
              </section>
              {alertList}
            </>
          )}
        </>
      )}
      {context.tab === "alerts" && (
        <>
          {alertList}
          {selectedAlert && (
            <section className="obs-card obs-alert-detail">
              <div className="obs-row">
                <h2>{selectedAlert.name}</h2>
                <Badge
                  tone={
                    error ||
                    !snapshot ||
                    !selectedMatches ||
                    selectedEvaluationFailed
                      ? "warn"
                      : selectedActive?.state === "firing"
                        ? "bad"
                        : selectedActive
                          ? "warn"
                          : "ok"
                  }
                >
                  {!snapshot || !selectedMatches || selectedEvaluationFailed
                    ? "Current state unknown: query this alert resource"
                    : error
                      ? "Current state unknown"
                      : selectedActive?.state ||
                        "No longer active at latest successful query"}
                </Badge>
              </div>
              <p>
                {selectedAlert.labels.job} · {selectedAlert.labels.instance} ·{" "}
                {selectedAlert.labels.mountpoint}
              </p>
              <p>{selectedAlert.annotations.description}</p>
              <h3>Checks to perform</h3>
              <p>
                {selectedAlert.annotations.check ||
                  "Check the affected target, recent measurements and exporter connectivity. The expression reports evidence, not a confirmed root cause."}
              </p>
              <small>
                Active since {date(selectedAlert.activeAt)} · Required duration{" "}
                {selectedAlert.duration}s · Rule health: {selectedAlert.health}
              </small>
              <pre>{selectedAlert.expression}</pre>
              <button
                onClick={() =>
                  void openGrafana(
                    context.resource === "host" ? "host" : "coreops",
                  )
                }
              >
                Investigate in Grafana <ArrowUpRight size={14} />
              </button>
            </section>
          )}
          {metricGrid}
          <h2>Rule definitions</h2>
          <p>
            Rules are evaluated by Prometheus. Filters constrain active alerts;
            inactive definitions have no instance history.
          </p>
          {snapshot?.rules.map((r, i) => (
            <details className="obs-card" key={`${r.name}-${i}`}>
              <summary>
                {r.name} · {r.state} · {r.labels.severity} · for {r.duration}s ·
                evaluation {r.health}
              </summary>
              {r.lastError && <p className="obs-error">{r.lastError}</p>}
              <p>{r.annotations.description}</p>
              <pre>{r.expression}</pre>
              <p>{r.annotations.check}</p>
            </details>
          ))}
        </>
      )}
      {context.tab === "integrations" && (
        <>
          <div className="obs-integrations">
            {(["prometheus", "grafana"] as const).map((name) => (
              <section className="obs-card" key={name}>
                <h2>{name === "prometheus" ? "Prometheus" : "Grafana"}</h2>
                <SourceBadge source={sources?.[name]} name={name} />
                <p>
                  {sources?.[name].endpoint ||
                    "Configure the source URL in the CoreOps backend environment."}
                </p>
                {sources?.[name].publicUrl && (
                  <p>Browser URL: {sources[name].publicUrl}</p>
                )}
                {sources?.[name].version && (
                  <p>Version {sources[name].version}</p>
                )}
                {sources?.[name].error && (
                  <p role="alert" className="obs-error">
                    {sources[name].error}
                  </p>
                )}
                <small>
                  {name === "grafana"
                    ? "Independent integration: CoreOps metrics work without Grafana. Browser access needs a reachable public URL and Grafana login."
                    : "Backend connection only. URLs, credentials, scrape and rule configuration remain on the server."}
                </small>
              </section>
            ))}
          </div>
          <h2>Scrape targets</h2>
          {targetError && (
            <p role="alert" className="obs-error">
              Target query failed: {targetError}. Any previous target state is
              stale.
            </p>
          )}
          <p>
            A successful scrape means Prometheus can collect this exporter, not
            that all application functions are healthy. Last scrape is an
            attempt time; down targets can retain older samples.
          </p>
          <div className="obs-resources">
            {filteredTargets.map((t) => (
              <section className="obs-card" key={t.id}>
                <div className="obs-row">
                  <strong>
                    {t.job} · {t.instance}
                  </strong>
                  <Badge tone={t.health === "up" ? "ok" : "bad"}>
                    {t.health}
                  </Badge>
                </div>
                <p>
                  Last attempt: {date(t.lastScrape)} ·{" "}
                  {t.scrapeDuration.toFixed(3)}s · Every {t.scrapeInterval}
                </p>
                {t.lastError && <p className="obs-error">{t.lastError}</p>}
                {["host", "coreops"].includes(t.kind) && (
                  <button onClick={() => selectResource(t)}>
                    Inspect resource →
                  </button>
                )}
              </section>
            ))}
          </div>
          {!loading && !targetError && filteredTargets.length === 0 && (
            <p>No targets configured for these filters.</p>
          )}
        </>
      )}
    </div>
  );
}
