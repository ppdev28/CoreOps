import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Search,
  RefreshCw,
  Play,
  Square,
  RotateCw,
  ArrowLeft,
  ExternalLink,
} from "lucide-react";
import { T } from "../lib/tokens";
import { getSession } from "../lib/auth";
import type { ConfirmDialog } from "../lib/types";
import ApplicationContainers from "../components/ApplicationContainers";
import ApplicationIcon from "../components/ApplicationIcon";
import { getContainers, type Container } from "../features/containers";
import "../styles/applications.css";
import type { AppService } from "../lib/types";
import {
  getApplications,
  runApplicationAction,
  type ApplicationAction,
} from "../lib/api";
import {
  Card,
  CardHeader,
  StatusBadge,
  Btn,
  Input,
  Skeleton,
  ErrorState,
} from "../components/ui";

const CATS = [
  "All",
  "Web",
  "Database",
  "Media",
  "Development",
  "Monitoring",
  "Automation",
  "Storage",
  "Security",
];
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

function AppIcon({
  app,
  size = 40,
  image = "",
}: {
  app: AppService;
  size?: number;
  image?: string;
}) {
  return (
    <ApplicationIcon
      name={app.name}
      category={app.category}
      icon={app.icon}
      image={image}
      size={size}
    />
  );
}

export default function ApplicationsView({
  addToast,
  onConfirm,
  renderContainer,
}: {
  onConfirm: (dialog: ConfirmDialog) => void;
  renderContainer: (
    id: string,
    application: string,
    onBack: () => void,
  ) => ReactNode;
  addToast: (m: string, t: any) => void;
}) {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("All");
  const [status, setStatus] = useState("all");
  const [composition, setComposition] = useState("all");
  const [order, setOrder] = useState("name");
  const [inventory, setInventory] = useState<Container[]>([]);
  const [metadataError, setMetadataError] = useState("");
  const pendingLoad = useRef<AbortController | null>(null);
  const [apps, setApps] = useState<AppService[]>([]);
  const [selected, setSelected] = useState<AppService | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [containerId, setContainerId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const canOperate = ["operator", "admin"].includes(
    getSession()?.user.role ?? "",
  );

  const load = useCallback(async (initial = false) => {
    pendingLoad.current?.abort();
    const controller = new AbortController();
    pendingLoad.current = controller;
    initial ? setLoading(true) : setRefreshing(true);
    try {
      const [appResult, containerResult] = await Promise.allSettled([
        getApplications(controller.signal),
        getContainers(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      if (appResult.status === "rejected") throw appResult.reason;
      const next = appResult.value;
      setApps(next);
      if (containerResult.status === "fulfilled") {
        setInventory(containerResult.value);
        setMetadataError("");
      } else {
        setInventory([]);
        setMetadataError(
          "Container metadata unavailable. Search currently covers application fields only.",
        );
      }
      setSelected((previous) =>
        previous
          ? (next.find((app) => app.id === previous.id) ?? previous)
          : null,
      );
      setRevision((value) => value + 1);
      setError("");
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Unable to load applications",
        );
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);
  useEffect(() => {
    void load(true);
    return () => pendingLoad.current?.abort();
  }, [load]);
  useEffect(() => {
    setActionError("");
  }, [selected?.id]);

  const categories = useMemo(() => {
    const present = new Set(apps.map((a) => a.category || "Other"));
    if (cat !== "All") present.add(cat);
    return [
      "All",
      ...CATS.filter((c) => c !== "All" && present.has(c)),
      ...Array.from(present)
        .filter((c) => !CATS.includes(c))
        .sort(),
    ];
  }, [apps, cat]);
  const members = useMemo(() => {
    const byId = new Map(
      inventory.map((container) => [container.id, container]),
    );
    return new Map(
      apps.map((app) => [
        app.id,
        (app.containerIds || []).flatMap((id) =>
          byId.get(id) ? [byId.get(id)!] : [],
        ),
      ]),
    );
  }, [apps, inventory]);
  const query = normalize(search);
  const filteredInstalled = useMemo(() => {
    const rows = apps.filter((app) => {
      if (cat !== "All" && (app.category || "Other") !== cat) return false;
      if (status !== "all" && app.status !== status) return false;
      if (composition === "single" && app.containers !== 1) return false;
      if (composition === "multi" && app.containers <= 1) return false;
      const fields = [
        app.name,
        app.description,
        app.category,
        app.version,
        app.status,
        app.id,
        ...(app.containerIds || []),
        ...(members.get(app.id) || []).flatMap((c) => [
          c.name,
          c.image,
          c.ports,
          c.net,
        ]),
      ].map(normalize);
      return query
        .split(/\s+/)
        .filter(Boolean)
        .every((term) => fields.some((field) => field.includes(term)));
    });
    return rows.sort((a, b) => {
      const name = a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (order === "name-desc") return -name;
      if (order === "containers") return b.containers - a.containers || name;
      if (order === "status") return a.status.localeCompare(b.status) || name;
      return name;
    });
  }, [apps, cat, status, composition, order, query, members]);
  const resetFilters = () => {
    setSearch("");
    setCat("All");
    setStatus("all");
    setComposition("all");
    setOrder("name");
  };
  const hasFilters =
    !!search ||
    cat !== "All" ||
    status !== "all" ||
    composition !== "all" ||
    order !== "name";

  async function actionApp(app: AppService, verb: ApplicationAction) {
    if (action || !canOperate) return;
    setActionError("");
    setAction(`${app.id}:${verb}`);
    try {
      await runApplicationAction(app.id, verb);
      addToast(
        `${verb[0].toUpperCase() + verb.slice(1)} ${app.name} completed`,
        "success",
      );
      await load(true);
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : `Unable to ${verb} ${app.name}`,
      );
      addToast(
        e instanceof Error ? e.message : `Unable to ${verb} ${app.name}`,
        "error",
      );
    } finally {
      setAction("");
    }
  }

  if (selected && containerId)
    return renderContainer(containerId, selected.name, () =>
      setContainerId(null),
    );
  if (selected) {
    const missing =
      !loading &&
      !refreshing &&
      !error &&
      !apps.some((app) => app.id === selected.id);
    return (
      <div className="applications-view application-detail">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <Btn
            variant="ghost"
            size="xs"
            onClick={() => setSelected(null)}
            icon={<ArrowLeft size={12} />}
          >
            Applications
          </Btn>
          <span style={{ color: T.textDim }}>/</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
            {selected.name}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 20,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <div
            className="application-identity"
            style={{ display: "flex", gap: 14, alignItems: "center" }}
          >
            <AppIcon
              app={selected}
              size={52}
              image={(members.get(selected.id) || [])
                .map((c) => `${c.name} ${c.image}`)
                .join(" ")}
            />
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: T.text }}>
                {selected.name}
              </h1>
              <div style={{ fontSize: 12, color: T.textDim, marginTop: 3 }}>
                {selected.description}
              </div>
              <div
                className="application-identity-meta"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 7,
                }}
              >
                <StatusBadge status={selected.status} />
                <span style={{ fontSize: 10, color: T.textDim }}>
                  {selected.category} · v{selected.version}
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn
              size="xs"
              variant="secondary"
              disabled={refreshing || !!action}
              onClick={() => void load(false)}
              icon={<RefreshCw size={11} />}
            >
              Refresh application
            </Btn>
            {canOperate && !missing && !error && (
              <>
                {selected.status === "running" ? (
                  <Btn
                    size="xs"
                    variant="secondary"
                    disabled={!!action}
                    onClick={() =>
                      onConfirm({
                        title: `Stop "${selected.name}"?`,
                        message:
                          "This stops the containers currently belonging to this application.",
                        action: "Stop application",
                        danger: true,
                        onConfirm: () => void actionApp(selected, "stop"),
                      })
                    }
                    icon={<Square size={10} />}
                  >
                    Stop
                  </Btn>
                ) : (
                  <Btn
                    size="xs"
                    variant="primary"
                    disabled={!!action}
                    onClick={() => void actionApp(selected, "start")}
                    icon={<Play size={10} />}
                  >
                    Start
                  </Btn>
                )}
                <Btn
                  size="xs"
                  variant="secondary"
                  disabled={!!action}
                  onClick={() =>
                    onConfirm({
                      title: `Restart "${selected.name}"?`,
                      message:
                        "Running containers belonging to this application will be briefly unavailable.",
                      action: "Restart application",
                      onConfirm: () => void actionApp(selected, "restart"),
                    })
                  }
                  icon={<RotateCw size={10} />}
                >
                  Restart
                </Btn>
              </>
            )}
          </div>
        </div>
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
          <Card>
            <CardHeader title="Containers" />
            <div style={{ padding: "16px" }}>
              <div
                style={{
                  fontSize: 25,
                  fontWeight: 700,
                  color: T.text,
                  fontFamily: "JetBrains Mono,monospace",
                }}
              >
                {selected.containers}
              </div>
              <div style={{ fontSize: 11, color: T.textDim }}>
                Docker containers in this application
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Version" />
            <div style={{ padding: "16px" }}>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: T.text,
                  fontFamily: "JetBrains Mono,monospace",
                }}
              >
                v{selected.version}
              </div>
              <div style={{ fontSize: 11, color: T.textDim }}>
                Detected from container images
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Status" />
            <div style={{ padding: "16px" }}>
              <StatusBadge status={selected.status} />
              <div style={{ fontSize: 11, color: T.textDim, marginTop: 8 }}>
                Aggregated from all application containers
              </div>
            </div>
          </Card>
        </div>
        {actionError && (
          <div className="application-action-error" role="alert">
            {actionError}
          </div>
        )}
        {error && (
          <div role="alert">
            {error} The last application snapshot may be stale.
          </div>
        )}
        {missing ? (
          <Card>
            <div role="status" style={{ padding: 20 }}>
              This application is no longer present in the Docker inventory.
              Return to Applications or refresh to check again.
            </div>
          </Card>
        ) : (
          <ApplicationContainers
            key={selected.id}
            ids={selected.containerIds}
            revision={revision}
            onInspect={setContainerId}
          />
        )}
        <Card>
          <CardHeader title="Application model" />
          <div
            style={{
              padding: "16px",
              fontSize: 12,
              color: T.textDim,
              lineHeight: 1.7,
            }}
          >
            CoreOps groups Docker Compose projects into applications using the{" "}
            <code style={{ color: T.textSub }}>com.docker.compose.project</code>{" "}
            label. Standalone containers are exposed as single-container
            applications. Custom{" "}
            <code style={{ color: T.textSub }}>coreops.application.*</code>{" "}
            labels can provide a friendly name, category, description and icon.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="applications-view">
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: T.text }}>
            Applications
          </h1>
          <p style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
            Higher-level services composed of one or more Docker containers.
          </p>
        </div>
        <Btn
          variant="secondary"
          size="xs"
          disabled={refreshing}
          onClick={() => void load(false)}
          icon={<RefreshCw size={11} />}
        >
          Refresh
        </Btn>
      </div>
      <section className="application-filters" aria-label="Application filters">
        <Input
          value={search}
          onChange={setSearch}
          placeholder="Search apps, containers, images…"
          icon={<Search size={14} />}
        />
        <label>
          Status
          <select
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            {Array.from(
              new Set([
                "running",
                "stopped",
                "paused",
                "restarting",
                "exited",
                ...apps.map((a) => a.status),
              ]),
            )
              .sort()
              .map((value) => (
                <option key={value} value={value}>
                  {value === "restarting"
                    ? "Partial / restarting"
                    : value[0].toUpperCase() + value.slice(1)}
                </option>
              ))}
          </select>
        </label>
        <label>
          Members
          <select
            aria-label="Members"
            value={composition}
            onChange={(e) => setComposition(e.target.value)}
          >
            <option value="all">Any number</option>
            <option value="single">One container</option>
            <option value="multi">Multiple containers</option>
          </select>
        </label>
        <label>
          Sort applications
          <select
            aria-label="Sort applications"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          >
            <option value="name">Name A–Z</option>
            <option value="name-desc">Name Z–A</option>
            <option value="containers">Most containers</option>
            <option value="status">Status</option>
          </select>
        </label>
        <div
          className="application-category-filters"
          role="group"
          aria-label="Application category"
        >
          {categories.map((c) => (
            <button
              type="button"
              key={c}
              aria-label={c}
              aria-pressed={cat === c}
              className="screen-filter-pill"
              onClick={() => setCat(c)}
            >
              {c}
              <span>
                {c === "All"
                  ? apps.length
                  : apps.filter((a) => (a.category || "Other") === c).length}
              </span>
            </button>
          ))}
        </div>
        <div className="application-filter-summary">
          <span role="status">
            {filteredInstalled.length} of {apps.length} applications
          </span>
          {hasFilters && (
            <button type="button" onClick={resetFilters}>
              Clear filters
            </button>
          )}
        </div>
      </section>
      {metadataError && (
        <p className="application-metadata-warning" role="status">
          {metadataError}
        </p>
      )}
      {error && (
        <div style={{ marginBottom: 12 }}>
          <ErrorState
            title="Applications unavailable"
            sub={error}
            onRetry={() => void load(true)}
          />
        </div>
      )}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} h={76} r={10} />
          ))}
        </div>
      ) : null}
      {!loading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filteredInstalled.length === 0 ? (
            <Card>
              <div
                style={{
                  padding: 30,
                  textAlign: "center",
                  color: T.textDim,
                  fontSize: 12,
                }}
              >
                No applications match the current search and filters.
              </div>
            </Card>
          ) : (
            filteredInstalled.map((app) => (
              <div
                data-surface="panel"
                className="installed-application-card"
                key={app.id}
                onClick={() => setSelected(app)}
                style={{
                  background: T.raised,
                  border: `1px solid ${T.border}`,
                  borderRadius: 10,
                  padding: "14px 18px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = T.borderStrong)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = T.border)
                }
              >
                <AppIcon
                  app={app}
                  image={(members.get(app.id) || [])
                    .map((c) => `${c.name} ${c.image}`)
                    .join(" ")}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 3,
                    }}
                  >
                    <span
                      style={{ fontSize: 13, fontWeight: 700, color: T.text }}
                    >
                      {app.name}
                    </span>
                    <StatusBadge status={app.status} />
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: T.textDim,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {app.description}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 18,
                    alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: T.text,
                        fontFamily: "JetBrains Mono,monospace",
                      }}
                    >
                      {app.containers}
                    </div>
                    <div style={{ fontSize: 10, color: T.textDim }}>
                      CONTAINERS
                    </div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: T.textSub,
                        fontFamily: "JetBrains Mono,monospace",
                      }}
                    >
                      v{app.version}
                    </div>
                    <div style={{ fontSize: 10, color: T.textDim }}>
                      VERSION
                    </div>
                  </div>
                  <Btn
                    size="xs"
                    variant="ghost"
                    icon={<ExternalLink size={10} />}
                  >
                    Open
                  </Btn>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
