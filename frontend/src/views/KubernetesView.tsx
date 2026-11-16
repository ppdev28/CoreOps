import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Network,
  Server,
  Box,
  Layers,
  Activity,
  RefreshCw,
  Settings2,
  Search,
  ArrowUpRight,
  ArrowLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Circle,
  FileText,
  ScrollText,
  RotateCw,
  Scaling,
  Download,
  Pause,
  Play,
  X,
  PlugZap,
  ShieldCheck,
  Clock3,
  HardDrive,
  KeyRound,
  MoreHorizontal,
} from "lucide-react";
import { getSession } from "../lib/auth";
import { getApiBase } from "../shared/api/client";
import { loadWebSettings, subscribeWebSettings } from "../lib/webSettings";
import {
  kubeClusters,
  kubeConnect,
  kubeDisconnect,
  kubeSnapshot,
  kubeDetail,
  kubeAction,
  kubeLogs,
  kubeYAML,
  kubeAge,
  kubeState,
  type KubeCluster,
  type KubeResource,
  type KubeSnapshot,
  type KubeDetail,
  type KubeKind,
  type KubeEvent,
  type KubeConnection,
} from "../lib/kubernetes";
import "../styles/kubernetes.css";

type Tab =
  | "overview"
  | "workloads"
  | "pods"
  | "incidents"
  | "nodes"
  | "network"
  | "configuration"
  | "storage";
type DetailTab = "overview" | "pods" | "events" | "logs" | "yaml";
type Filters = {
  cluster: string;
  namespace: string;
  search: string;
  status: string;
  tab: Tab;
  workload: KubeKind;
};
const filterKey = () => `coreops.kubernetes.filters:${getApiBase()}`;
function initialFilters(): Filters {
  const defaults: Filters = {
    cluster: "",
    namespace: "",
    search: "",
    status: "all",
    tab: "overview",
    workload: "deployments",
  };
  try {
    const s = JSON.parse(sessionStorage.getItem(filterKey()) || "{}");
    return {
      ...defaults,
      ...Object.fromEntries(
        Object.entries(s).filter(
          ([k, v]) => k in defaults && typeof v === "string",
        ),
      ),
      tab: [
        "overview",
        "workloads",
        "pods",
        "incidents",
        "nodes",
        "network",
        "configuration",
        "storage",
      ].includes(s.tab)
        ? s.tab
        : "overview",
      workload: ["deployments", "statefulsets", "daemonsets"].includes(
        s.workload,
      )
        ? s.workload
        : "deployments",
    };
  } catch {
    return defaults;
  }
}
const tabItems: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <Activity size={15} /> },
  { id: "workloads", label: "Workloads", icon: <Layers size={15} /> },
  { id: "pods", label: "Pods", icon: <Box size={15} /> },
  { id: "incidents", label: "Incidents", icon: <AlertTriangle size={15} /> },
  { id: "nodes", label: "Nodes", icon: <Server size={15} /> },
  { id: "network", label: "Network", icon: <Network size={15} /> },
  { id: "configuration", label: "Configuration", icon: <KeyRound size={15} /> },
  { id: "storage", label: "Storage", icon: <HardDrive size={15} /> },
];
const kindLabels: Record<KubeKind, string> = {
  deployments: "Deployments",
  statefulsets: "StatefulSets",
  daemonsets: "DaemonSets",
  pods: "Pods",
  nodes: "Nodes",
};
const message = (e: unknown) =>
  e instanceof Error ? e.message : "The operation could not be completed.";
function Notice({
  children,
  tone = "warning",
}: {
  children: ReactNode;
  tone?: "warning" | "info" | "success";
}) {
  return (
    <div
      className={`kube-notice ${tone}`}
      role={tone === "warning" ? "alert" : "status"}
    >
      {tone === "success" ? (
        <CheckCircle2 size={16} />
      ) : tone === "warning" ? (
        <AlertTriangle size={16} />
      ) : (
        <Activity size={16} />
      )}
      <div>{children}</div>
    </div>
  );
}
function Badge({ resource }: { resource: KubeResource }) {
  return (
    <span
      className={`kube-badge ${resource.problem ? "warn" : resource.ready || resource.phase === "Succeeded" ? "good" : "muted"}`}
    >
      <span />
      {kubeState(resource)}
    </span>
  );
}
function Empty({
  title,
  children,
  icon = <Box size={25} />,
  action,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="kube-empty">
      <div className="kube-empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Events({ events, error }: { events: KubeEvent[]; error?: string }) {
  return error ? (
    <Notice>{error}</Notice>
  ) : events.length ? (
    <div className="kube-events">
      {events.map((e, i) => (
        <article key={e.uid || `${e.time}-${i}`} className="kube-event">
          <span
            className={`kube-event-dot ${e.type === "Warning" ? "warn" : ""}`}
          />
          <div>
            <div className="kube-event-top">
              <strong>{e.reason || e.type}</strong>
              <time dateTime={e.time} title={e.time}>
                {e.time
                  ? new Date(e.time).toLocaleString()
                  : "Time unavailable"}
              </time>
            </div>
            <p>{e.message}</p>
            <small>
              {e.namespace} / {e.resource}
              {e.count > 1 ? ` · ${e.count} occurrences` : ""}
            </small>
          </div>
        </article>
      ))}
    </div>
  ) : (
    <Empty title="No retained events" icon={<Clock3 size={25} />}>
      Kubernetes events are temporary. An empty history does not confirm that a
      resource is healthy.
    </Empty>
  );
}
function ResourceList({
  resources,
  kind,
  error,
  onOpen,
  usage,
}: {
  resources: KubeResource[];
  kind: KubeKind;
  error?: string;
  onOpen: (r: KubeResource, t?: DetailTab) => void;
  usage?: KubeSnapshot["nodeUsage"];
}) {
  if (error) return <Notice>{error}</Notice>;
  if (!resources.length)
    return (
      <Empty title={`No matching ${kindLabels[kind].toLowerCase()}`}>
        Try another namespace or clear the search and status filters.
      </Empty>
    );
  return (
    <div className={`kube-resource-list ${kind}`}>
      <div className="kube-list-head">
        <span>Resource</span>
        <span>Status</span>
        <span>{kind === "nodes" ? "Capacity" : "Readiness"}</span>
        <span>
          {kind === "pods"
            ? "Restarts · Node"
            : kind === "nodes"
              ? "Current usage"
              : "Images"}
        </span>
        <span>Age</span>
        <span />
      </div>
      {resources.map((r) => (
        <button
          className="kube-resource-row"
          key={r.uid}
          onClick={() => onOpen(r)}
        >
          <span className="kube-resource-name">
            <span className="kube-resource-symbol">
              {kind === "nodes" ? (
                <Server size={17} />
              ) : kind === "pods" ? (
                <Box size={17} />
              ) : (
                <Layers size={17} />
              )}
            </span>
            <span>
              <strong>{r.name}</strong>
              <small>{r.namespace || "Cluster scoped"}</small>
            </span>
          </span>
          <span>
            <Badge resource={r} />
            {kind === "pods" && (
              <small className="kube-row-phase">
                Phase: {r.phase || "Unknown"}
              </small>
            )}
          </span>
          <span className="kube-resource-replicas">
            <small className="kube-mobile-label">
              {kind === "nodes" ? "Capacity" : "Ready"}
            </small>
            {kind === "nodes" ? (
              <>
                {r.cpu || "—"} CPU
                <small>{r.memory || "Memory unavailable"}</small>
                <small>
                  {r.podCount === null
                    ? "Pod count: select all namespaces"
                    : `${r.podCount} pods in permitted scope`}
                </small>
              </>
            ) : (
              <>
                <b>{r.available}</b>
                <span className="kube-dim"> / {r.desired}</span>
                <small>{kind === "pods" ? "containers" : "replicas"}</small>
              </>
            )}
          </span>
          <span className="kube-resource-extra">
            {kind === "pods" ? (
              <>
                <span className={r.restarts >= 3 ? "kube-warning" : ""}>
                  {r.restarts} restarts
                </span>
                <small>{r.node || "Not scheduled"}</small>
              </>
            ) : kind === "nodes" ? (
              <>
                {usage?.[r.name] ? (
                  <>
                    {usage[r.name].cpu} CPU
                    <small>{usage[r.name].memory} memory</small>
                  </>
                ) : (
                  <span className="kube-dim">Metrics unavailable</span>
                )}
              </>
            ) : (
              <>
                <span title={r.images.join(", ")}>
                  {r.images[0] || "Image unavailable"}
                </span>
                {r.images.length > 1 && (
                  <small>+{r.images.length - 1} more</small>
                )}
              </>
            )}
          </span>
          <span className="kube-resource-age">{kubeAge(r.created)}</span>
          <ChevronRight className="kube-row-arrow" size={16} />
        </button>
      ))}
    </div>
  );
}
function IncidentList({
  resources,
  onOpen,
  limit,
}: {
  resources: KubeResource[];
  onOpen: (r: KubeResource, t?: DetailTab) => void;
  limit?: number;
}) {
  const incidents = resources.filter((r) => r.problem);
  if (!incidents.length)
    return (
      <Empty
        title="No issues detected in available data"
        icon={<ShieldCheck size={25} />}
      >
        This view checks readiness, restarts, scheduling and reported container
        failures.
      </Empty>
    );
  return (
    <div className="kube-incidents">
      {incidents.slice(0, limit).map((r) => (
        <article className="kube-incident" key={r.uid}>
          <div className="kube-incident-title">
            <AlertTriangle size={16} />
            <button onClick={() => onOpen(r)}>{r.name}</button>
            <span>{r.namespace}</span>
          </div>
          <strong>
            {r.reason ||
              (r.restarts >= 3
                ? "Repeated container restarts"
                : r.kind === "pods"
                  ? "Pod needs attention"
                  : "Deployment is incomplete")}
          </strong>
          <p>
            {r.message ||
              (r.restarts >= 3
                ? `Kubernetes reports ${r.restarts} restarts. Inspect events and previous logs to determine the cause.`
                : `${r.available} of ${r.desired} replicas available. The underlying cause has not been confirmed.`)}
          </p>
          <div className="kube-incident-footer">
            <small>Observed state · cause unconfirmed</small>
            <button onClick={() => onOpen(r, "events")}>
              Events <ArrowUpRight size={12} />
            </button>
            <button
              onClick={() => onOpen(r, r.kind === "pods" ? "logs" : "pods")}
            >
              {r.kind === "pods" ? "Logs" : "Find pod logs"}
              <ArrowUpRight size={12} />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function KubernetesView() {
  const role = getSession()?.user.role;
  const [filters, setFilters] = useState(initialFilters);
  const [settings, setSettings] = useState(loadWebSettings);
  const [showMore, setShowMore] = useState(() =>
    ["network", "configuration", "storage"].includes(filters.tab),
  );
  const [clusters, setClusters] = useState<KubeCluster[]>([]),
    [clustersLoaded, setClustersLoaded] = useState(false),
    [clusterError, setClusterError] = useState("");
  const [snapshot, setSnapshot] = useState<{
      key: string;
      value: KubeSnapshot;
    } | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(false),
    [selection, setSelection] = useState<{
      resource: KubeResource;
      tab: DetailTab;
    } | null>(null);
  const loadSeq = useRef(0);
  const activeSnapshot = useRef<AbortController | null>(null);
  const scope = `${filters.cluster}/${filters.namespace}`;
  const data = snapshot?.key === scope ? snapshot.value : null;
  const change = useCallback((value: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...value }));
  }, []);
  useEffect(() => subscribeWebSettings(setSettings), []);
  useEffect(() => {
    try {
      sessionStorage.setItem(filterKey(), JSON.stringify(filters));
    } catch {}
  }, [filters]);
  const loadClusters = useCallback(async () => {
    setClusterError("");
    try {
      const c = await kubeClusters();
      setClusters(c);
      setFilters((f) => ({
        ...f,
        cluster: c.some((c) => c.id === f.cluster) ? f.cluster : c[0]?.id || "",
        namespace: c.some((c) => c.id === f.cluster) ? f.namespace : "",
      }));
    } catch (e) {
      setClusterError(message(e));
    } finally {
      setClustersLoaded(true);
    }
  }, []);
  useEffect(() => {
    void loadClusters();
  }, [loadClusters]);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!filters.cluster) return;
      if (activeSnapshot.current && !activeSnapshot.current.signal.aborted)
        return;
      const controller = new AbortController();
      activeSnapshot.current = controller;
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const seq = ++loadSeq.current;
      setLoading(true);
      try {
        const next = await kubeSnapshot(
          filters.cluster,
          filters.namespace,
          controller.signal,
        );
        if (seq !== loadSeq.current || controller.signal.aborted) return;
        setSnapshot({ key: scope, value: next });
        setError("");
      } catch (e) {
        if (seq === loadSeq.current && !controller.signal.aborted)
          setError(message(e));
      } finally {
        signal?.removeEventListener("abort", abort);
        if (activeSnapshot.current === controller)
          activeSnapshot.current = null;
        if (seq === loadSeq.current && !controller.signal.aborted)
          setLoading(false);
      }
    },
    [filters.cluster, filters.namespace, scope],
  );
  useEffect(() => {
    const c = new AbortController();
    setError("");
    void refresh(c.signal);
    return () => {
      c.abort();
      activeSnapshot.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (!settings.autoRefresh || !filters.cluster) return;
    const c = new AbortController();
    const id = setInterval(
      () => {
        if (!document.hidden) void refresh(c.signal);
      },
      Math.max(5, settings.refreshSeconds) * 1000,
    );
    return () => {
      clearInterval(id);
      c.abort();
    };
  }, [settings.autoRefresh, settings.refreshSeconds, filters.cluster, refresh]);
  const cluster = clusters.find((c) => c.id === filters.cluster);
  const open = (resource: KubeResource, tab: DetailTab = "overview") => {
    setSelection({ resource, tab });
    window.scrollTo({ top: 0 });
  };
  const matches = (r: KubeResource) => {
    const search = filters.search.toLowerCase();
    return (
      `${r.name} ${r.namespace} ${r.images.join(" ")} ${r.node} ${r.reason}`
        .toLowerCase()
        .includes(search) &&
      (filters.status === "all" ||
        (filters.status === "healthy" &&
          (r.ready || r.phase === "Succeeded")) ||
        (filters.status === "attention" && r.problem) ||
        (filters.status === "pending" &&
          (r.phase === "Pending" || (!r.ready && !r.problem))))
    );
  };
  const resources = (kind: KubeKind) =>
    data?.resources[kind]?.filter(matches) || [];
  const pods = data?.resources.pods,
    deployments = data?.resources.deployments,
    nodes = data?.resources.nodes;
  const readyPods = pods?.filter((p) => p.ready).length,
    pendingPods = pods?.filter((p) => p.phase === "Pending").length,
    problemPods = pods?.filter((p) => p.problem).length;
  const incidents = [...(pods || []), ...(deployments || [])]
    .filter(matches)
    .sort((a, b) => b.restarts - a.restarts);
  const incomplete = deployments?.filter((d) => !d.ready).length;
  const busy = loading && !data;
  return (
    <div className="kube-view">
      <div className="kube-page-title">
        <div>
          <div className="kube-eyebrow">
            INFRASTRUCTURE <ChevronRight size={11} /> CLUSTER OPERATIONS
          </div>
          <h1>
            <span className="kube-title-icon">
              <Network size={23} />
            </span>
            Kubernetes
          </h1>
          <p>
            Understand cluster health. Find the cause. Restore your
            applications.
          </p>
        </div>
        <span className="kube-version">
          <ShieldCheck size={13} /> Backend-managed connection
        </span>
      </div>
      <div className="kube-connection-bar">
        <label>
          <span>Cluster</span>
          <select
            aria-label="Cluster"
            value={filters.cluster}
            onChange={(e) => {
              change({ cluster: e.target.value, namespace: "" });
              setSelection(null);
            }}
            disabled={!clusters.length}
          >
            <option value="" disabled>
              Select a cluster
            </option>
            {clusters.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div
          className={`kube-connection-status ${error ? "warn" : data ? "good" : ""}`}
        >
          <span />
          {!filters.cluster
            ? "Not connected"
            : error
              ? "Connection issue"
              : busy
                ? "Connecting…"
                : data
                  ? "Connected"
                  : "Awaiting connection"}
        </div>
        <label>
          <span>Namespace</span>
          <select
            aria-label="Namespace"
            value={filters.namespace}
            disabled={!cluster}
            onChange={(e) => {
              change({ namespace: e.target.value });
              setSelection(null);
            }}
          >
            <option value="">All permitted</option>
            {(
              data?.namespaces ||
              (cluster?.namespaces || []).filter((n) => n !== "*")
            ).map((n) => (
              <option value={n} key={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="kube-update">
          <Clock3 size={13} />
          <span>
            {data
              ? `Updated ${new Date(data.updatedAt).toLocaleTimeString()}`
              : "Not yet updated"}
            {loading && data ? " · refreshing" : ""}
          </span>
        </div>
        <button
          className="kube-icon-button"
          aria-label="Refresh Kubernetes"
          title="Refresh"
          disabled={!cluster || loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} className={loading ? "kube-spin" : ""} />
        </button>
        {role === "admin" && (
          <button
            className="kube-button"
            onClick={() => setConnectionOpen(true)}
          >
            <Settings2 size={15} />
            <span>Connections</span>
          </button>
        )}
      </div>
      {clusterError && (
        <Notice>
          {clusterError}
          <button
            className="kube-inline-link"
            onClick={() => void loadClusters()}
          >
            Try again
          </button>
        </Notice>
      )}
      {error && (
        <Notice>
          {error}
          {data && (
            <strong>
              {" "}
              Displaying stale data from{" "}
              {new Date(data.updatedAt).toLocaleString()}. Refresh before
              acting.
            </strong>
          )}
        </Notice>
      )}
      {!clustersLoaded ? (
        <div className="kube-loading" role="status">
          Loading cluster connections…
        </div>
      ) : !cluster && !clusterError ? (
        <div className="kube-card kube-onboarding">
          <Empty
            title="Your cluster, one operational workspace"
            icon={<Network size={32} />}
            action={
              role === "admin" ? (
                <button
                  className="kube-button primary"
                  onClick={() => setConnectionOpen(true)}
                >
                  <PlugZap size={16} /> Connect a cluster
                </button>
              ) : (
                <Notice tone="info">
                  An administrator must configure the cluster connection.
                </Notice>
              )
            }
          >
            Connect an existing Kubernetes API to inspect workloads, trace pod
            failures and verify recovery. Credentials stay on the CoreOps
            backend.
          </Empty>
          <div className="kube-onboarding-steps">
            <span>
              <Activity size={18} />
              <b>01</b> Check health
            </span>
            <span>
              <ScrollText size={18} />
              <b>02</b> Inspect events & logs
            </span>
            <span>
              <RotateCw size={18} />
              <b>03</b> Act & verify recovery
            </span>
          </div>
        </div>
      ) : (
        <>
          <nav
            className="kube-tabs"
            data-more={showMore}
            aria-label="Kubernetes sections"
          >
            {tabItems.map((t) => (
              <button
                key={t.id}
                className={`${filters.tab === t.id ? "active" : ""} ${["network", "configuration", "storage"].includes(t.id) ? "kube-extra-tab" : ""}`}
                aria-current={filters.tab === t.id ? "page" : undefined}
                onClick={() => {
                  change({ tab: t.id });
                  setSelection(null);
                }}
              >
                {t.icon}
                {t.label}
                {t.id === "incidents" && data && (
                  <span
                    className={
                      incidents.filter((r) => r.problem).length
                        ? "kube-count warning"
                        : "kube-count"
                    }
                  >
                    {incidents.filter((r) => r.problem).length}
                  </span>
                )}
              </button>
            ))}
            <button
              className="kube-tabs-more"
              aria-expanded={showMore}
              onClick={() => setShowMore((v) => !v)}
            >
              <MoreHorizontal size={15} />
              More
            </button>
          </nav>
          <div className="kube-filter-bar">
            <label className="kube-search">
              <Search size={16} />
              <input
                aria-label="Search Kubernetes resources"
                placeholder="Search resources, images, nodes…"
                value={filters.search}
                onChange={(e) => change({ search: e.target.value })}
              />
              {filters.search && (
                <button
                  aria-label="Clear resource search"
                  onClick={() => change({ search: "" })}
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <select
              aria-label="Resource status"
              value={filters.status}
              onChange={(e) => change({ status: e.target.value })}
            >
              <option value="all">All states</option>
              <option value="healthy">Ready / available</option>
              <option value="attention">Needs attention</option>
              <option value="pending">Pending / progressing</option>
            </select>
            <span className="kube-filter-scope">
              <ShieldCheck size={13} />
              {filters.namespace || "All permitted namespaces"}
            </span>
          </div>
          {selection ? (
            <KubernetesDetail
              key={`${filters.cluster}/${selection.resource.uid}`}
              cluster={filters.cluster}
              selection={selection}
              stale={!!error}
              onBack={() => setSelection(null)}
              onOpen={open}
              onRefresh={() => void refresh()}
            />
          ) : busy ? (
            <div
              className="kube-skeleton"
              role="status"
              aria-label="Loading Kubernetes resources"
            >
              {[0, 1, 2, 3].map((i) => (
                <div key={i} />
              ))}
              <p>Reading cluster resources…</p>
            </div>
          ) : data ? (
            <>
              {filters.tab === "overview" && (
                <>
                  <div className="kube-section-heading">
                    <div>
                      <h2>Cluster at a glance</h2>
                      <p>
                        Namespace-scoped workloads · Nodes and usage cover the
                        cluster.
                      </p>
                    </div>
                    <span className="kube-small">
                      {data.errors.pods || data.errors.deployments
                        ? "Partial visibility"
                        : "Live API snapshot"}
                    </span>
                  </div>
                  <div className="kube-stat-grid">
                    <button
                      className="kube-stat"
                      onClick={() => change({ tab: "nodes" })}
                    >
                      <span>
                        <Server size={17} /> Available nodes{" "}
                        <ArrowUpRight size={14} />
                      </span>
                      <strong>
                        {nodes ? `${nodes.filter((n) => n.ready).length}` : "—"}
                        <small> / {nodes?.length ?? "—"}</small>
                      </strong>
                      <p>
                        {data.errors.nodes || "Ready nodes · cluster scope"}
                      </p>
                    </button>
                    <button
                      className="kube-stat"
                      onClick={() => change({ tab: "pods" })}
                    >
                      <span>
                        <Box size={17} /> Prepared pods{" "}
                        <ArrowUpRight size={14} />
                      </span>
                      <strong>
                        {readyPods ?? "—"}
                        <small> / {pods?.length ?? "—"}</small>
                      </strong>
                      <p>
                        {pods ? (
                          <>
                            <span className="kube-warning">
                              {problemPods} need attention
                            </span>{" "}
                            · {pendingPods} pending
                          </>
                        ) : (
                          data.errors.pods
                        )}
                      </p>
                    </button>
                    <button
                      className="kube-stat"
                      onClick={() =>
                        change({ tab: "workloads", workload: "deployments" })
                      }
                    >
                      <span>
                        <Layers size={17} /> Deployments{" "}
                        <ArrowUpRight size={14} />
                      </span>
                      <strong>
                        {deployments
                          ? deployments.length - (incomplete || 0)
                          : "—"}
                        <small> / {deployments?.length ?? "—"}</small>
                      </strong>
                      <p>
                        {deployments
                          ? `${incomplete} incomplete · all replicas required`
                          : data.errors.deployments}
                      </p>
                    </button>
                    <button
                      className="kube-stat"
                      onClick={() => change({ tab: "nodes" })}
                    >
                      <span>
                        <Activity size={17} /> CPU usage{" "}
                        <ArrowUpRight size={14} />
                      </span>
                      <strong>
                        {data.metrics ? data.metrics.cpuCores.toFixed(2) : "—"}
                        <small>{data.metrics ? " cores" : ""}</small>
                      </strong>
                      <p>
                        {data.metrics
                          ? `${data.metrics.nodes} node samples · ${new Date(data.metrics.time).toLocaleTimeString()}`
                          : "Metrics unavailable"}
                      </p>
                    </button>
                    <button
                      className="kube-stat"
                      onClick={() => change({ tab: "nodes" })}
                    >
                      <span>
                        <HardDrive size={17} /> Memory usage{" "}
                        <ArrowUpRight size={14} />
                      </span>
                      <strong>
                        {data.metrics
                          ? (data.metrics.memoryBytes / 1024 ** 3).toFixed(2)
                          : "—"}
                        <small>{data.metrics ? " GiB" : ""}</small>
                      </strong>
                      <p>
                        {data.metrics
                          ? `Sample window ${data.metrics.window}`
                          : "No values estimated"}
                      </p>
                    </button>
                  </div>
                  {data.errors.metrics && (
                    <Notice tone="info">{data.errors.metrics}</Notice>
                  )}
                  {Object.entries(data.errors)
                    .filter(([k]) => k !== "metrics")
                    .map(([k, e]) => (
                      <Notice key={k}>
                        {kindLabels[k as KubeKind] || k}: {e}
                      </Notice>
                    ))}
                  <div className="kube-overview-grid">
                    <section className="kube-card">
                      <div className="kube-card-heading">
                        <div>
                          <h2>Needs attention</h2>
                          <p>Start with evidence, then take action.</p>
                        </div>
                        <button
                          className="kube-text-button"
                          onClick={() => change({ tab: "incidents" })}
                        >
                          View all <ArrowUpRight size={14} />
                        </button>
                      </div>
                      <IncidentList
                        resources={incidents}
                        onOpen={open}
                        limit={4}
                      />
                    </section>
                    <section className="kube-card">
                      <div className="kube-card-heading">
                        <div>
                          <h2>Recent events</h2>
                          <p>Newest reported cluster activity.</p>
                        </div>
                        <Clock3 size={17} />
                      </div>
                      <Events
                        events={data.events
                          .filter(
                            (e) =>
                              !filters.search ||
                              `${e.resource} ${e.namespace} ${e.message}`
                                .toLowerCase()
                                .includes(filters.search.toLowerCase()),
                          )
                          .slice(0, 6)}
                        error={data.errors.events}
                      />
                    </section>
                  </div>
                  <section className="kube-card">
                    <div className="kube-card-heading">
                      <div>
                        <h2>Deployments</h2>
                        <p>Availability and rollout status.</p>
                      </div>
                      <button
                        className="kube-text-button"
                        onClick={() => change({ tab: "workloads" })}
                      >
                        All workloads <ArrowUpRight size={14} />
                      </button>
                    </div>
                    <ResourceList
                      kind="deployments"
                      resources={resources("deployments").slice(0, 5)}
                      error={data.errors.deployments}
                      onOpen={open}
                    />
                  </section>
                </>
              )}
              {filters.tab === "workloads" && (
                <section className="kube-card">
                  <div className="kube-card-heading">
                    <div>
                      <h2>Workloads</h2>
                      <p>
                        Desired state, available replicas and rollout health.
                      </p>
                    </div>
                    <span className="kube-count">
                      {resources(filters.workload).length}
                    </span>
                  </div>
                  <div
                    className="kube-segmented"
                    role="tablist"
                    aria-label="Workload kind"
                  >
                    {(
                      [
                        "deployments",
                        "statefulsets",
                        "daemonsets",
                      ] as KubeKind[]
                    ).map((k) => (
                      <button
                        key={k}
                        role="tab"
                        aria-selected={filters.workload === k}
                        onClick={() => change({ workload: k })}
                      >
                        {kindLabels[k]}
                      </button>
                    ))}
                  </div>
                  <ResourceList
                    kind={filters.workload}
                    resources={resources(filters.workload)}
                    error={data.errors[filters.workload]}
                    onOpen={open}
                  />
                </section>
              )}
              {filters.tab === "pods" && (
                <section className="kube-card">
                  <div className="kube-card-heading">
                    <div>
                      <h2>Pods</h2>
                      <p>
                        Running describes execution. Ready describes readiness
                        to serve traffic.
                      </p>
                    </div>
                    <span className="kube-count">
                      {resources("pods").length}
                    </span>
                  </div>
                  <ResourceList
                    kind="pods"
                    resources={resources("pods")}
                    error={data.errors.pods}
                    onOpen={open}
                  />
                </section>
              )}
              {filters.tab === "incidents" && (
                <section className="kube-card">
                  <div className="kube-card-heading">
                    <div>
                      <h2>Incidents</h2>
                      <p>
                        Reported failures, repeated restarts and incomplete
                        Deployments.
                      </p>
                    </div>
                    <span className="kube-count warning">
                      {incidents.filter((r) => r.problem).length}
                    </span>
                  </div>
                  {(data.errors.pods || data.errors.deployments) && (
                    <Notice>
                      Visibility is incomplete.{" "}
                      {data.errors.pods || data.errors.deployments}
                    </Notice>
                  )}
                  <IncidentList resources={incidents} onOpen={open} />
                </section>
              )}
              {filters.tab === "nodes" && (
                <section className="kube-card">
                  <div className="kube-card-heading">
                    <div>
                      <h2>Nodes</h2>
                      <p>
                        Cluster-scoped health, capacity and current usage where
                        available.
                      </p>
                    </div>
                    <span className="kube-count">
                      {resources("nodes").length}
                    </span>
                  </div>
                  <ResourceList
                    kind="nodes"
                    resources={resources("nodes")}
                    error={data.errors.nodes}
                    usage={data.nodeUsage}
                    onOpen={open}
                  />
                </section>
              )}
              {["network", "configuration", "storage"].includes(
                filters.tab,
              ) && (
                <section className="kube-card">
                  <Empty
                    title={
                      filters.tab === "network"
                        ? "Network inspection is a planned extension"
                        : filters.tab === "configuration"
                          ? "Configuration inspection is a planned extension"
                          : "Storage inspection is a planned extension"
                    }
                    icon={tabItems.find((t) => t.id === filters.tab)?.icon}
                  >
                    {filters.tab === "network"
                      ? "Services, Ingresses and Gateway API routes will expose selectors, endpoints and destinations when the cluster provides them."
                      : filters.tab === "configuration"
                        ? "ConfigMaps and Secret metadata will be available here. Secret values will stay hidden."
                        : "PersistentVolumes and claims will show capacity, storage class and application relationships."}{" "}
                    This first version focuses on workloads, diagnostics and
                    Deployment recovery.
                  </Empty>
                </section>
              )}
            </>
          ) : error ? (
            <Empty
              title="Unable to read this cluster"
              icon={<PlugZap size={28} />}
              action={
                <button className="kube-button" onClick={() => void refresh()}>
                  Retry connection
                </button>
              }
            >
              Check connectivity, credentials and namespace permissions. No
              resource counts are inferred.
            </Empty>
          ) : null}
        </>
      )}
      {connectionOpen && (
        <ConnectionDialog
          clusters={clusters}
          onClose={() => setConnectionOpen(false)}
          onSaved={(c) => {
            setSelection(null);
            change({ cluster: c.id, namespace: "" });
            void loadClusters();
            setConnectionOpen(false);
          }}
          onRemoved={() => {
            setSelection(null);
            setSnapshot(null);
            void loadClusters();
          }}
        />
      )}
    </div>
  );
}

function ConnectionDialog({
  clusters,
  onClose,
  onSaved,
  onRemoved,
}: {
  clusters: KubeCluster[];
  onClose: () => void;
  onSaved: (c: KubeCluster) => void;
  onRemoved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [method, setMethod] = useState("token"),
    [remove, setRemove] = useState<KubeCluster | null>(null);
  const [form, setForm] = useState({
    name: "",
    server: "",
    namespaces: "default",
    ca: "",
    token: "",
    certificate: "",
    key: "",
  });
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const update = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const connection: KubeConnection = {
        ...form,
        namespaces: form.namespaces
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        token: method === "token" ? form.token : "",
        certificate: method === "certificate" ? form.certificate : "",
        key: method === "certificate" ? form.key : "",
      };
      onSaved(await kubeConnect(connection));
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  return (
    <dialog
      className="kube-dialog"
      ref={ref}
      aria-labelledby="kube-connect-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="kube-dialog-header">
        <div>
          <span className="kube-eyebrow">BACKEND CONNECTION</span>
          <h2 id="kube-connect-title">Connect Kubernetes</h2>
        </div>
        <button
          className="kube-icon-button"
          aria-label="Close cluster connection"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <form onSubmit={(e) => void submit(e)}>
        <div className="kube-dialog-body">
          {error && <Notice>{error}</Notice>}
          <Notice tone="info">
            The CoreOps backend connects to the API over verified HTTPS. These
            credentials are shared by authorized CoreOps users within the
            configured namespaces. Use a dedicated account with limited RBAC
            permissions.
          </Notice>
          {clusters.length > 0 && (
            <details className="kube-saved-connections">
              <summary>Saved connections ({clusters.length})</summary>
              {clusters.map((c) => (
                <div key={c.id}>
                  <span>
                    <strong>{c.name}</strong>
                    <small>{c.server}</small>
                  </span>
                  <button
                    className="kube-text-button"
                    type="button"
                    disabled={busy}
                    onClick={() => setRemove(c)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </details>
          )}
          {remove && (
            <Notice>
              Remove the saved connection “{remove.name}”? Resources in the
              cluster will remain in place.
              <div className="kube-dialog-actions">
                <button
                  type="button"
                  className="kube-button"
                  disabled={busy}
                  onClick={() => setRemove(null)}
                >
                  Cancel removal
                </button>
                <button
                  type="button"
                  className="kube-button danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await kubeDisconnect(remove.id);
                      setRemove(null);
                      onRemoved();
                    } catch (e) {
                      setError(message(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remove connection
                </button>
              </div>
            </Notice>
          )}
          <div className="kube-form-grid">
            <label>
              Connection name
              <input
                required
                maxLength={80}
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Production"
                disabled={busy}
              />
            </label>
            <label>
              API server
              <input
                required
                type="url"
                value={form.server}
                onChange={(e) => update("server", e.target.value)}
                placeholder="https://cluster.example:6443"
                disabled={busy}
              />
            </label>
          </div>
          <label>
            Permitted namespaces
            <input
              aria-label="Permitted namespaces"
              aria-describedby="kube-namespace-help"
              required
              value={form.namespaces}
              onChange={(e) => update("namespaces", e.target.value)}
              placeholder="default, applications"
              disabled={busy}
            />
            <small id="kube-namespace-help">
              Comma-separated scope. Use * only if the account can list
              namespaces and resources across the cluster. Kubernetes RBAC still
              applies.
            </small>
          </label>
          <label>
            Certificate authority (PEM)
            <textarea
              aria-label="Certificate authority (PEM)"
              aria-describedby="kube-ca-help"
              rows={3}
              value={form.ca}
              onChange={(e) => update("ca", e.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----"
              spellCheck={false}
              disabled={busy}
            />
            <small id="kube-ca-help">
              Leave empty to use trusted system certificate authorities. TLS
              verification is always enabled.
            </small>
          </label>
          <label>
            Authentication
            <select
              aria-label="Authentication"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              disabled={busy}
            >
              <option value="token">Bearer token</option>
              <option value="certificate">Client certificate</option>
            </select>
          </label>
          {method === "token" ? (
            <label>
              Bearer token
              <input
                type="password"
                autoComplete="off"
                required
                value={form.token}
                onChange={(e) => update("token", e.target.value)}
                disabled={busy}
              />
            </label>
          ) : (
            <div className="kube-form-grid">
              <label>
                Client certificate (PEM)
                <textarea
                  rows={4}
                  required
                  value={form.certificate}
                  onChange={(e) => update("certificate", e.target.value)}
                  spellCheck={false}
                  disabled={busy}
                />
              </label>
              <label>
                Private key (PEM)
                <textarea
                  rows={4}
                  required
                  value={form.key}
                  onChange={(e) => update("key", e.target.value)}
                  spellCheck={false}
                  disabled={busy}
                />
              </label>
            </div>
          )}
          <p className="kube-small">
            <ShieldCheck size={13} /> Credentials are stored privately on the
            backend and are never returned in connection listings. Executable
            credential plugins are not supported.
          </p>
        </div>
        <div className="kube-dialog-footer">
          <button
            className="kube-button"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="kube-button primary" disabled={busy} type="submit">
            <PlugZap size={15} />
            {busy ? "Verifying connection…" : "Verify & connect"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function KubernetesDetail({
  cluster,
  selection,
  stale,
  onBack,
  onOpen,
  onRefresh,
}: {
  cluster: string;
  selection: { resource: KubeResource; tab: DetailTab };
  stale: boolean;
  onBack: () => void;
  onOpen: (r: KubeResource, t?: DetailTab) => void;
  onRefresh: () => void;
}) {
  const [data, setData] = useState<KubeDetail | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState<DetailTab>(selection.tab),
    [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(loadWebSettings);
  useEffect(() => subscribeWebSettings(setSettings), []);
  const [action, setAction] = useState<"scale" | "restart" | null>(null),
    [replicas, setReplicas] = useState("1"),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState("");
  const [operation, setOperation] = useState<{
      action: string;
      generation: number;
      uid: string;
      replicas: number;
      started: number;
    } | null>(null),
    [operationState, setOperationState] = useState<
      "waiting" | "recovered" | "changed" | "superseded"
    >("waiting");
  const [yaml, setYaml] = useState(""),
    [yamlError, setYamlError] = useState("");
  const sequence = useRef(0),
    mounted = useRef(true);
  const activeDetail = useRef<AbortController | null>(null);
  const resource = data?.resource || selection.resource;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (activeDetail.current && !activeDetail.current.signal.aborted) return;
      const controller = new AbortController();
      activeDetail.current = controller;
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const seq = ++sequence.current;
      try {
        const d = await kubeDetail(
          cluster,
          selection.resource,
          controller.signal,
        );
        if (
          !mounted.current ||
          controller.signal.aborted ||
          seq !== sequence.current
        )
          return;
        setData(d);
        setError("");
      } catch (e) {
        if (
          mounted.current &&
          !controller.signal.aborted &&
          seq === sequence.current
        )
          setError(message(e));
      } finally {
        signal?.removeEventListener("abort", abort);
        if (activeDetail.current === controller) activeDetail.current = null;
        if (
          mounted.current &&
          !controller.signal.aborted &&
          seq === sequence.current
        )
          setLoading(false);
      }
    },
    [cluster, selection.resource],
  );
  useEffect(() => {
    mounted.current = true;
    const c = new AbortController();
    void load(c.signal);
    return () => {
      mounted.current = false;
      c.abort();
      activeDetail.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    const verifying = !!operation && operationState === "waiting";
    if (!verifying && !settings.autoRefresh) return;
    const c = new AbortController();
    const id = setInterval(
      () => {
        if (verifying || !document.hidden) void load(c.signal);
      },
      verifying ? 3000 : Math.max(5, settings.refreshSeconds) * 1000,
    );
    return () => {
      clearInterval(id);
      c.abort();
    };
  }, [
    operation,
    operationState,
    load,
    settings.autoRefresh,
    settings.refreshSeconds,
  ]);
  useEffect(() => {
    if (!operation || !data) return;
    if (data.resource.uid !== operation.uid) setOperationState("changed");
    else if (
      data.resource.generation > operation.generation ||
      (data.resource.generation === operation.generation &&
        data.resource.desired !== operation.replicas)
    )
      setOperationState("superseded");
    else if (
      data.resource.generation === operation.generation &&
      data.resource.observedGeneration >= operation.generation &&
      data.resource.ready
    )
      setOperationState("recovered");
  }, [data, operation]);
  useEffect(() => {
    setYaml("");
    setYamlError("");
    if (tab !== "yaml" || !data?.permissions.yaml) return;
    const c = new AbortController();
    void kubeYAML(cluster, resource, c.signal)
      .then((v) => {
        if (!c.signal.aborted) setYaml(v.yaml);
      })
      .catch((e) => {
        if (!c.signal.aborted) setYamlError(message(e));
      });
    return () => c.abort();
  }, [tab, cluster, resource.uid, resource.version, data?.permissions.yaml]);
  async function execute() {
    if (!action || busy || !data) return;
    setBusy(true);
    setActionError("");
    try {
      await kubeAction(
        cluster,
        resource,
        action,
        action === "scale" ? Number(replicas) : undefined,
      );
      if (!mounted.current) return;
      setOperation({
        action,
        generation:
          resource.generation +
          (action === "scale" && Number(replicas) === resource.desired ? 0 : 1),
        uid: resource.uid,
        replicas: action === "scale" ? Number(replicas) : resource.desired,
        started: Date.now(),
      });
      setOperationState("waiting");
      setAction(null);
      void load();
      onRefresh();
    } catch (e) {
      if (mounted.current) setActionError(message(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const permittedTabs: DetailTab[] = [
    "overview",
    ...(resource.kind !== "pods" ? ["pods" as const] : ["logs" as const]),
    "events",
    "yaml",
  ];
  return (
    <div className="kube-detail">
      <button className="kube-text-button" onClick={onBack}>
        <ArrowLeft size={15} /> Back to resources
      </button>
      <div className="kube-detail-title">
        <div>
          <div className="kube-eyebrow">
            {kindLabels[resource.kind]} / {resource.namespace || "CLUSTER"}
          </div>
          <h2>{resource.name}</h2>
          <Badge resource={resource} />
        </div>
        <div className="kube-detail-actions">
          <button
            className="kube-icon-button"
            aria-label="Refresh resource detail"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw size={16} />
          </button>
          {resource.kind === "deployments" && data && (
            <>
              <button
                className="kube-button"
                disabled={
                  !data.permissions.scale ||
                  resource.uid !== selection.resource.uid ||
                  busy ||
                  stale ||
                  !!error ||
                  (operationState === "waiting" && !!operation)
                }
                title={
                  !data.permissions.scale
                    ? "CoreOps operator and Kubernetes patch deployments/scale permissions required"
                    : undefined
                }
                onClick={() => {
                  setReplicas(String(resource.desired));
                  setAction("scale");
                  setActionError("");
                }}
              >
                <Scaling size={15} /> Scale
              </button>
              <button
                className="kube-button"
                disabled={
                  !data.permissions.restart ||
                  resource.uid !== selection.resource.uid ||
                  busy ||
                  stale ||
                  !!error ||
                  (operationState === "waiting" && !!operation)
                }
                title={
                  !data.permissions.restart
                    ? "CoreOps operator and Kubernetes patch deployments permissions required"
                    : undefined
                }
                onClick={() => {
                  setAction("restart");
                  setActionError("");
                }}
              >
                <RotateCw size={15} /> Rolling restart
              </button>
            </>
          )}
        </div>
      </div>
      {error && (
        <Notice>
          {error}
          {data ? " Detail may be stale." : ""}
        </Notice>
      )}
      {data?.actionNote && <Notice tone="info">{data.actionNote}</Notice>}
      {resource.uid !== selection.resource.uid && (
        <Notice>
          This name now belongs to a different resource. Return to the list and
          inspect the replacement.
        </Notice>
      )}
      {actionError && !action && <Notice>{actionError}</Notice>}
      {operation && (
        <Notice
          tone={
            operationState === "recovered"
              ? "success"
              : operationState === "changed" || operationState === "superseded"
                ? "warning"
                : "info"
          }
        >
          {operationState === "recovered"
            ? "Recovery verified: the controller observed the requested generation and all updated replicas are available."
            : operationState === "changed"
              ? "The resource was replaced. Recovery of the original Deployment could not be verified."
              : operationState === "superseded"
                ? "Another change superseded the requested generation. Inspect the current desired state; recovery of this operation has not been confirmed."
                : `${operation.action === "scale" ? "Scale" : "Restart"} accepted by Kubernetes. Waiting for the controller and replica readiness…`}
          {operationState === "waiting" && (
            <div className="kube-small">
              {resource.available} / {resource.desired} available ·{" "}
              {resource.updated} updated · observed generation{" "}
              {resource.observedGeneration} / {operation.generation}. Failures
              remain visible in conditions and events.
            </div>
          )}
        </Notice>
      )}
      {loading ? (
        <div className="kube-loading" role="status">
          Loading resource detail…
        </div>
      ) : (
        data && (
          <>
            <div className="kube-detail-metrics">
              <div>
                <small>
                  {resource.kind === "nodes"
                    ? "CPU capacity"
                    : resource.kind === "pods"
                      ? "Prepared containers"
                      : "Available replicas"}
                </small>
                <strong>
                  {resource.kind === "nodes"
                    ? resource.cpu || "—"
                    : `${resource.available} / ${resource.desired}`}
                </strong>
              </div>
              <div>
                <small>
                  {resource.kind === "pods"
                    ? "Restarts"
                    : resource.kind === "nodes"
                      ? "Memory capacity"
                      : "Updated replicas"}
                </small>
                <strong>
                  {resource.kind === "pods"
                    ? resource.restarts
                    : resource.kind === "nodes"
                      ? resource.memory || "—"
                      : resource.updated}
                </strong>
              </div>
              <div>
                <small>
                  {resource.kind === "pods"
                    ? "Node"
                    : resource.kind === "nodes"
                      ? "Pods in permitted scope"
                      : "Controller observed"}
                </small>
                <strong>
                  {resource.kind === "pods"
                    ? resource.node || "Not scheduled"
                    : resource.kind === "nodes"
                      ? data.errors.pods
                        ? "Unavailable"
                        : data.pods.length
                      : `${resource.observedGeneration} / ${resource.generation}`}
                </strong>
              </div>
              <div>
                <small>Created</small>
                <strong>{kubeAge(resource.created)} ago</strong>
              </div>
            </div>
            <nav className="kube-detail-tabs" aria-label="Resource details">
              {permittedTabs.map((t) => (
                <button
                  key={t}
                  className={tab === t ? "active" : ""}
                  aria-current={tab === t ? "page" : undefined}
                  onClick={() => setTab(t)}
                >
                  {t === "yaml" ? (
                    <FileText size={14} />
                  ) : t === "logs" ? (
                    <ScrollText size={14} />
                  ) : null}
                  {t === "yaml" ? "YAML" : t[0].toUpperCase() + t.slice(1)}
                  {t === "events" && (
                    <span className="kube-count">{data.events.length}</span>
                  )}
                </button>
              ))}
            </nav>
            {tab === "overview" && (
              <div className="kube-overview-grid">
                <section className="kube-card">
                  <div className="kube-card-heading">
                    <div>
                      <h3>
                        {resource.kind === "pods"
                          ? "Container state"
                          : "Conditions"}
                      </h3>
                      <p>
                        {resource.kind === "pods"
                          ? "Readiness is separate from execution state."
                          : "Conditions reported by the Kubernetes controller."}
                      </p>
                    </div>
                    <ShieldCheck size={17} />
                  </div>
                  {resource.kind === "pods" &&
                    resource.containers.map((c) => (
                      <article className="kube-container" key={c.name}>
                        <div>
                          <strong>
                            {c.name}
                            {c.init ? " · init" : ""}
                          </strong>
                          <span
                            className={`kube-badge ${c.ready ? "good" : "muted"}`}
                          >
                            {c.state} · {c.ready ? "Ready" : "Not ready"}
                          </span>
                        </div>
                        <code>{c.image}</code>
                        {c.reason && (
                          <p className="kube-warning">
                            {c.reason}: {c.message}
                          </p>
                        )}
                        <dl>
                          <dt>Restarts</dt>
                          <dd>{c.restarts}</dd>
                          <dt>Requests</dt>
                          <dd>
                            {Object.entries(c.requests)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(" · ") || "Not set"}
                          </dd>
                          <dt>Limits</dt>
                          <dd>
                            {Object.entries(c.limits)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(" · ") || "Not set"}
                          </dd>
                        </dl>
                      </article>
                    ))}
                  {resource.conditions.length ? (
                    <div className="kube-conditions">
                      {resource.conditions.map((c) => (
                        <article key={c.type}>
                          <div>
                            {c.status === "True" ? (
                              <CheckCircle2 size={15} />
                            ) : (
                              <Circle size={15} />
                            )}
                            <strong>{c.type}</strong>
                            <span className="kube-small">{c.status}</span>
                          </div>
                          <b>{c.reason}</b>
                          <p>{c.message || "No additional message"}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty title="No conditions reported">
                      The API did not provide resource conditions.
                    </Empty>
                  )}
                </section>
                <section className="kube-card">
                  <div className="kube-card-heading">
                    <div>
                      <h3>Resource information</h3>
                      <p>Read-only identity and desired state.</p>
                    </div>
                    <Layers size={17} />
                  </div>
                  <dl className="kube-info">
                    {resource.kind === "pods" && (
                      <>
                        <dt>Execution phase</dt>
                        <dd>{resource.phase || "Unknown"}</dd>
                        <dt>Traffic readiness</dt>
                        <dd>{resource.ready ? "Ready" : "Not ready"}</dd>
                      </>
                    )}
                    <dt>Namespace</dt>
                    <dd>{resource.namespace || "Cluster scoped"}</dd>
                    <dt>UID</dt>
                    <dd>
                      <code>{resource.uid}</code>
                    </dd>
                    <dt>Resource version</dt>
                    <dd>{resource.version}</dd>
                    <dt>Images</dt>
                    <dd>
                      {resource.images.length
                        ? resource.images.map((i) => <code key={i}>{i}</code>)
                        : "Not applicable"}
                    </dd>
                    {resource.kind === "nodes" && (
                      <>
                        <dt>Allocatable CPU</dt>
                        <dd>{resource.allocatableCpu || "Unavailable"}</dd>
                        <dt>Allocatable memory</dt>
                        <dd>{resource.allocatableMemory || "Unavailable"}</dd>
                      </>
                    )}
                  </dl>
                  {resource.kind === "deployments" && (
                    <div className="kube-rollout">
                      <h3>Rollout progress</h3>
                      <progress
                        aria-label="Deployment rollout progress"
                        value={Math.min(resource.available, resource.desired)}
                        max={Math.max(1, resource.desired)}
                      />
                      <p>
                        {resource.available} available · {resource.updated}{" "}
                        updated · {resource.desired} desired
                      </p>
                      <small>
                        Recovery requires the controller to observe the current
                        generation and make the updated replicas available.
                      </small>
                    </div>
                  )}
                  <div className="kube-card-footer">
                    <button
                      className="kube-button"
                      onClick={() => setTab("events")}
                    >
                      <Clock3 size={14} /> Inspect events
                    </button>
                    {resource.kind === "pods" && (
                      <button
                        className="kube-button"
                        onClick={() => setTab("logs")}
                      >
                        <ScrollText size={14} /> Read logs
                      </button>
                    )}
                  </div>
                </section>
              </div>
            )}
            {tab === "pods" && (
              <section className="kube-card">
                <div className="kube-card-heading">
                  <h3>
                    {resource.kind === "nodes"
                      ? "Assigned pods in permitted namespaces"
                      : "Pods matching the workload selector"}
                  </h3>
                </div>
                <ResourceList
                  kind="pods"
                  resources={data.pods}
                  error={data.errors.pods}
                  onOpen={onOpen}
                />
              </section>
            )}
            {tab === "events" && (
              <section className="kube-card">
                <div className="kube-card-heading">
                  <div>
                    <h3>Related events</h3>
                    <p>Newest first · Includes related pod events.</p>
                  </div>
                </div>
                <Events events={data.events} error={data.errors.events} />
              </section>
            )}
            {tab === "logs" && (
              <PodLogs
                cluster={cluster}
                resource={resource}
                allowed={data.permissions.logs}
              />
            )}
            {tab === "yaml" && (
              <section className="kube-card">
                <div className="kube-card-heading">
                  <div>
                    <h3>Resource manifest</h3>
                    <p>
                      Read-only · Managed fields and last-applied annotation
                      omitted.
                    </p>
                  </div>
                  <span className="kube-badge muted">YAML</span>
                </div>
                {!data.permissions.yaml ? (
                  <Notice>
                    Manifest access requires a CoreOps operator or admin role.
                  </Notice>
                ) : yamlError ? (
                  <Notice>{yamlError}</Notice>
                ) : yaml ? (
                  <pre className="kube-code" tabIndex={0}>
                    {yaml}
                  </pre>
                ) : (
                  <div className="kube-loading" role="status">
                    Loading YAML…
                  </div>
                )}
              </section>
            )}
          </>
        )
      )}
      {action && (
        <ActionDialog
          resource={resource}
          action={action}
          replicas={replicas}
          onReplicas={setReplicas}
          busy={busy}
          error={actionError}
          onClose={() => {
            if (!busy) setAction(null);
          }}
          onSubmit={() => void execute()}
        />
      )}
    </div>
  );
}

function ActionDialog({
  resource,
  action,
  replicas,
  onReplicas,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  resource: KubeResource;
  action: "scale" | "restart";
  replicas: string;
  onReplicas: (v: string) => void;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="kube-dialog kube-action-dialog"
      aria-labelledby="kube-action-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onSubmit();
        }}
      >
        <div className="kube-dialog-header">
          <h2 id="kube-action-title">
            {action === "scale"
              ? "Scale Deployment"
              : "Restart Deployment progressively"}
          </h2>
          <button
            type="button"
            className="kube-icon-button"
            aria-label="Close action"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="kube-dialog-body">
          {error && <Notice>{error}</Notice>}
          <dl className="kube-action-target">
            <dt>Resource</dt>
            <dd>{resource.name}</dd>
            <dt>Namespace</dt>
            <dd>{resource.namespace}</dd>
            <dt>Current replicas</dt>
            <dd>
              {resource.available} available / {resource.desired} desired
            </dd>
          </dl>
          {action === "scale" ? (
            <label>
              Desired replicas
              <input
                aria-label="Desired replicas"
                type="number"
                min={0}
                max={1000}
                step={1}
                required
                value={replicas}
                disabled={busy}
                onChange={(e) => onReplicas(e.target.value)}
              />
              {replicas === "0" && (
                <small className="kube-warning">
                  Scaling to zero stops all replicas and may interrupt traffic.
                </small>
              )}
            </label>
          ) : (
            <p>
              Kubernetes will replace this Deployment’s pods according to its
              rollout strategy. Availability depends on readiness checks and
              rollout configuration.
            </p>
          )}
          <p className="kube-small">
            The change and its API result are recorded in the CoreOps audit log.
            The screen then checks real controller progress.
          </p>
        </div>
        <div className="kube-dialog-footer">
          <button
            type="button"
            className="kube-button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="kube-button primary" disabled={busy} type="submit">
            {busy
              ? "Submitting change…"
              : action === "scale"
                ? "Confirm scale"
                : "Confirm rolling restart"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function PodLogs({
  cluster,
  resource,
  allowed,
}: {
  cluster: string;
  resource: KubeResource;
  allowed: boolean;
}) {
  const [container, setContainer] = useState(
      resource.containers.find((c) => !c.init)?.name ||
        resource.containers[0]?.name ||
        "",
    ),
    [previous, setPrevious] = useState(false),
    [paused, setPaused] = useState(false),
    [search, setSearch] = useState(""),
    [text, setText] = useState(""),
    [updated, setUpdated] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const output = useRef<HTMLPreElement>(null);
  useEffect(() => {
    setText("");
    setUpdated("");
    setError("");
  }, [container, previous]);
  useEffect(() => {
    if (!allowed || !container || paused) return;
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    async function read() {
      setLoading(true);
      try {
        const logs = await kubeLogs(
          cluster,
          resource,
          container,
          previous,
          c.signal,
        );
        if (!active) return;
        setText(logs.text);
        setUpdated(logs.updatedAt);
        setError("");
      } catch (e) {
        if (active) setError(message(e));
      } finally {
        if (active) {
          setLoading(false);
          if (!previous) timer = setTimeout(() => void read(), 2500);
        }
      }
    }
    void read();
    return () => {
      active = false;
      c.abort();
      clearTimeout(timer);
    };
  }, [cluster, resource.uid, container, previous, paused, allowed]);
  useEffect(() => {
    if (!paused && output.current)
      output.current.scrollTop = output.current.scrollHeight;
  }, [text, paused]);
  const selected = resource.containers.find((c) => c.name === container);
  const lines = text
    .split("\n")
    .filter((l) => !search || l.toLowerCase().includes(search.toLowerCase()));
  function download() {
    const b = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${resource.namespace}-${resource.name}-${container}${previous ? "-previous" : ""}.log`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="kube-card kube-log-card">
      <div className="kube-card-heading">
        <div>
          <h3>Container logs</h3>
          <p>
            Live snapshots · Latest 1,000 lines / 256 KiB. Downloads include
            this retained snapshot.
          </p>
        </div>
        <span className={`kube-badge ${paused || previous ? "muted" : "good"}`}>
          {previous ? "Previous execution" : paused ? "Paused" : "Following"}
        </span>
      </div>
      {!allowed ? (
        <Notice>
          Logs require a CoreOps operator or admin role and Kubernetes get
          pods/log permission. Access checks fail closed.
        </Notice>
      ) : (
        <>
          <div className="kube-log-toolbar">
            <label>
              Container
              <select
                aria-label="Log container"
                value={container}
                onChange={(e) => {
                  setContainer(e.target.value);
                  setPrevious(false);
                  setPaused(false);
                }}
              >
                {resource.containers.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                    {c.init ? " (init)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="kube-log-search">
              <Search size={15} />
              <input
                aria-label="Search pod logs"
                placeholder="Search logs…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="kube-checkbox">
              <input
                type="checkbox"
                checked={previous}
                disabled={!selected || selected.restarts === 0}
                onChange={(e) => {
                  setPrevious(e.target.checked);
                  setPaused(false);
                }}
              />
              Previous execution
            </label>
            <button
              className="kube-button"
              disabled={previous}
              onClick={() => setPaused((v) => !v)}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}{" "}
              {paused ? "Resume" : "Pause"}
            </button>
            <button className="kube-button" disabled={!text} onClick={download}>
              <Download size={14} /> Download
            </button>
          </div>
          {error && (
            <Notice>
              {error}{" "}
              {text
                ? "The retained log snapshot is stale."
                : previous
                  ? "Previous logs may no longer be retained by the runtime."
                  : ""}
            </Notice>
          )}
          <pre
            className="kube-code kube-log-output"
            ref={output}
            tabIndex={0}
            aria-label="Pod log output"
          >
            {text
              ? lines.join("\n") || "No lines match your search."
              : loading
                ? "Loading logs…"
                : paused
                  ? "Log following is paused."
                  : "No log lines returned."}
          </pre>
          <div className="kube-log-footer">
            <span>
              {updated
                ? `Last read ${new Date(updated).toLocaleTimeString()}`
                : "No snapshot yet"}
              {loading && text ? " · refreshing" : ""}
            </span>
            <span>
              {search
                ? `${lines.length} matching lines`
                : "Timestamps from Kubernetes"}
            </span>
          </div>
          <Notice tone="info">
            Interactive pod terminals are planned for a later version; no host
            shell is used as a substitute.
          </Notice>
        </>
      )}
    </section>
  );
}
