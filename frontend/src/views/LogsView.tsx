import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownWideNarrow,
  Box,
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  Columns2,
  FileText,
  Filter,
  ListFilter,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  Settings2,
  WrapText,
  X,
} from "lucide-react";
import { getContainers, getHostLogSources } from "../lib/api";
import { getSession } from "../lib/auth";
import {
  ALL_LOGS,
  LOG_LEVELS,
  HOST_LOG_SOURCES,
  type LogSource,
} from "../lib/logs";
import type { Container, HostLogCatalog } from "../lib/types";
import { loadWebSettings } from "../lib/webSettings";
import LogPane, { type LogCache, type LogFilters } from "../components/LogPane";
import "../styles/logs.css";

const defaultFilters: LogFilters = {
  search: "",
  matchCase: false,
  exclude: false,
  levels: [...LOG_LEVELS],
  wrap: true,
  timestamps: true,
  lineNumbers: false,
  fontSize: 12,
  tail: 500,
  since: "",
  until: "",
  unit: "",
};

export default function LogsView({
  initialContainerId,
}: {
  initialContainerId?: string | null;
}) {
  const canRead = ["admin", "operator"].includes(getSession()?.user.role || "");
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [hostCatalog, setHostCatalog] = useState<HostLogCatalog | null>(null);
  const [hostError, setHostError] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeDraft, setRangeDraft] = useState({
    since: "",
    until: "",
    unit: "",
  });
  const [catalogError, setCatalogError] = useState("");
  const [tabs, setTabs] = useState<LogSource[]>(() =>
    initialContainerId
      ? [
          ALL_LOGS,
          {
            id: `container:${initialContainerId}`,
            name: initialContainerId.slice(0, 12),
            kind: "container",
            containerId: initialContainerId,
          },
        ]
      : [ALL_LOGS],
  );
  const [activeId, setActiveId] = useState(() =>
    initialContainerId ? `container:${initialContainerId}` : "all",
  );
  const [compareId, setCompareId] = useState<string | null>(null);
  const [split, setSplit] = useState(false);
  const [following, setFollowing] = useState(
    () => loadWebSettings().autoRefresh,
  );
  const [filters, setFilters] = useState(defaultFilters);
  const [findSource, setFindSource] = useState("");
  const [runningOnly, setRunningOnly] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourcesHidden, setSourcesHidden] = useState(false);
  const [focus, setFocus] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const cache = useRef<LogCache>(new Map());
  const searchRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabsRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs]);
  useEffect(() => {
    const find = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", find);
    return () => window.removeEventListener("keydown", find);
  }, []);

  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const load = async () => {
      try {
        const next = await getContainers(controller.signal);
        if (!controller.signal.aborted) {
          setContainers(next);
          setCatalogError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setCatalogError(
            cause instanceof Error
              ? cause.message
              : "Unable to load log sources",
          );
      } finally {
        if (!controller.signal.aborted && following)
          timer = window.setTimeout(() => void load(), 15000);
      }
    };
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [following, canRead, refresh]);
  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    getHostLogSources(controller.signal)
      .then((catalog) => {
        if (!controller.signal.aborted) {
          setHostCatalog(catalog);
          setHostError("");
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setHostError(
            cause instanceof Error
              ? cause.message
              : "Host log discovery unavailable",
          );
      });
    return () => controller.abort();
  }, [canRead, refresh]);
  useEffect(() => {
    if (!focus) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFocus(false);
        setSourcesOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [focus]);
  const openSource = useCallback(
    (source: LogSource, compare = false) => {
      setNotice("");
      if (!tabs.some((tab) => tab.id === source.id) && tabs.length >= 8) {
        setNotice(
          "Up to eight sources can be open. Close a tab to open another.",
        );
        return;
      }
      setTabs((previous) =>
        previous.some((tab) => tab.id === source.id)
          ? previous
          : [...previous, source],
      );
      if (compare) {
        setCompareId(source.id);
        setSplit(true);
      } else {
        setActiveId(source.id);
      }
      setSourcesOpen(false);
    },
    [tabs],
  );
  const openedInitial = useRef<string | null>(initialContainerId || null);
  useEffect(() => {
    if (!initialContainerId || openedInitial.current === initialContainerId)
      return;
    openedInitial.current = initialContainerId;
    openSource({
      id: `container:${initialContainerId}`,
      name: initialContainerId.slice(0, 12),
      kind: "container",
      containerId: initialContainerId,
    });
  }, [initialContainerId, openSource]);
  const resolveSource = (source: LogSource): LogSource =>
    source.kind === "container"
      ? {
          ...source,
          name:
            containers?.find((container) => container.id === source.containerId)
              ?.name || source.name,
        }
      : source;
  const active = resolveSource(
    tabs.find((tab) => tab.id === activeId) || tabs[0],
  );
  const compared =
    tabs.find((tab) => tab.id === compareId && tab.id !== active.id) ||
    tabs.find((tab) => tab.id !== active.id);
  const compare = compared ? resolveSource(compared) : null;
  const closeTab = (id: string) => {
    const remaining = tabs.filter((tab) => tab.id !== id);
    if (!remaining.length) {
      remaining.push(ALL_LOGS);
    }
    setTabs(remaining);
    for (const key of cache.current.keys()) {
      if (key.startsWith(`${id}:`)) cache.current.delete(key);
    }
    if (activeId === id) setActiveId(remaining[0].id);
    if (remaining.length < 2) setSplit(false);
  };
  const visibleContainers = useMemo(() => {
    const query = findSource.toLowerCase();
    return (containers || [])
      .filter(
        (container) =>
          (!runningOnly || container.status === "running") &&
          `${container.name} ${container.image}`.toLowerCase().includes(query),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [containers, findSource, runningOnly]);
  const running = containers?.filter(
    (container) => container.status === "running",
  ).length;
  const toggleLevel = (level: string) =>
    setFilters((previous) => ({
      ...previous,
      levels: previous.levels.includes(level)
        ? previous.levels.filter((item) => item !== level)
        : [...previous.levels, level],
    }));
  const sourceButton = (source: LogSource, icon: React.ReactNode) => (
    <button
      key={source.id}
      className={`logs-source-button ${active.id === source.id ? "is-active" : ""}`}
      onClick={() => openSource(source)}
      aria-pressed={active.id === source.id}
    >
      {icon}
      <span>{source.name}</span>
      <ChevronRight size={12} />
    </button>
  );
  return (
    <div
      className={`logs-workspace ${sourcesHidden ? "sources-hidden" : ""} ${focus ? "is-focused" : ""}`}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "f") {
          event.preventDefault();
          event.stopPropagation();
          searchRef.current?.focus();
        }
      }}
    >
      <header className="logs-workspace-header">
        <div className="logs-heading">
          <FileText size={19} />
          <h1>Logs</h1>
          <span className="logs-heading-divider" />
          <span className="logs-heading-subtitle">Log explorer</span>
        </div>
        <div className="logs-workspace-actions">
          <button
            className="logs-mobile-source-toggle"
            aria-label="Select log source"
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen(!sourcesOpen)}
          >
            <Box size={15} />
            <span>Sources</span>
            <ChevronDown size={12} />
          </button>
          <button
            className="logs-desktop-source-toggle"
            aria-label={sourcesHidden ? "Show log sources" : "Hide log sources"}
            title={sourcesHidden ? "Show sources" : "Hide sources"}
            onClick={() => setSourcesHidden(!sourcesHidden)}
          >
            {sourcesHidden ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
          </button>
          <button
            aria-label="Compare log sources"
            title="Compare two open sources"
            disabled={tabs.length < 2}
            aria-pressed={split}
            onClick={() => setSplit(!split)}
          >
            <Columns2 size={16} />
            <span className="logs-action-label">Compare</span>
          </button>
          <button
            aria-label={following ? "Pause log updates" : "Resume log updates"}
            className={`logs-follow ${following ? "is-following" : ""}`}
            onClick={() => setFollowing(!following)}
          >
            {following ? <Pause size={14} /> : <Play size={14} />}
            <span>{following ? "Pause" : "Resume"}</span>
          </button>
          <button
            aria-label={focus ? "Exit logs focus mode" : "Focus log viewer"}
            title={focus ? "Exit focus mode (Escape)" : "Focus mode"}
            onClick={() => setFocus(!focus)}
          >
            {focus ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </header>
      <div className="logs-workspace-body">
        {sourcesOpen && (
          <button
            className="logs-source-backdrop"
            aria-label="Close log sources"
            onClick={() => setSourcesOpen(false)}
          />
        )}
        <aside
          className={`logs-sources ${sourcesOpen ? "is-open" : ""}`}
          aria-label="Log sources"
        >
          <div className="logs-source-search">
            <Search size={14} />
            <input
              aria-label="Find log sources"
              value={findSource}
              onChange={(event) => setFindSource(event.target.value)}
              placeholder="Find log sources…"
            />
            <button
              aria-label="Show running containers only"
              title="Running containers only"
              aria-pressed={runningOnly}
              onClick={() => setRunningOnly(!runningOnly)}
            >
              <ListFilter size={14} />
            </button>
          </div>
          <nav aria-label="Log source navigation">
            <div className="logs-source-section">
              <span>HOST</span>
              <Server size={12} />
            </div>
            {sourceButton(ALL_LOGS, <FileText size={15} />)}
            {HOST_LOG_SOURCES.map((source) =>
              sourceButton(source, <Server size={15} />),
            )}
            <details className="logs-file-catalog">
              <summary>
                HOST LOG FILES · {hostCatalog?.files.length ?? "—"}
              </summary>
              {hostError && (
                <p className="logs-catalog-error" role="alert">
                  {hostError}
                </p>
              )}
              {hostCatalog?.warnings.map((warning, index) => (
                <p className="logs-catalog-error" key={index}>
                  {warning}
                </p>
              ))}
              {hostCatalog?.files
                .filter((file) =>
                  file.name.toLowerCase().includes(findSource.toLowerCase()),
                )
                .map((file) => (
                  <button
                    key={file.path}
                    className="logs-source-button"
                    title={`${file.name}${file.readable ? "" : " · permission required"}`}
                    aria-label={`Open host log ${file.path}`}
                    onClick={() =>
                      openSource({
                        id: `file:${file.path}`,
                        name: file.name,
                        kind: "file",
                        filePath: file.path,
                      })
                    }
                  >
                    <FileText size={15} />
                    <span>{file.path}</span>
                    <small>
                      {!file.readable ? "Locked" : file.archive ? "GZ" : ""}
                    </small>
                  </button>
                ))}
              {hostCatalog?.files.length === 0 && (
                <p className="logs-source-placeholder">
                  No supported text log files discovered.
                </p>
              )}
            </details>
            <div className="logs-source-section">
              <span>CONTAINERS</span>
              <span>{containers ? visibleContainers.length : "—"}</span>
            </div>
            {catalogError && (
              <div className="logs-catalog-error" role="alert">
                <AlertCircle size={14} />
                <span>{catalogError}</span>
                <button
                  aria-label="Retry log sources"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            )}
            {!containers && !catalogError && canRead && (
              <p className="logs-source-placeholder">Loading containers…</p>
            )}
            {!canRead && (
              <p className="logs-source-placeholder">
                Operator access required
              </p>
            )}
            {visibleContainers.map((container) => {
              const source: LogSource = {
                id: `container:${container.id}`,
                name: container.name,
                kind: "container",
                containerId: container.id,
              };
              return (
                <div
                  className={`logs-container-source ${active.id === source.id ? "is-active" : ""}`}
                  key={container.id}
                >
                  <button
                    className="logs-source-button"
                    aria-label={`Open logs for ${container.name}`}
                    aria-pressed={active.id === source.id}
                    onClick={() => openSource(source)}
                  >
                    <i
                      className={`logs-source-status is-${container.status}`}
                      title={container.status}
                    />
                    <span>
                      <strong>{container.name}</strong>
                      <small title={container.image}>{container.image}</small>
                    </span>
                  </button>
                  <button
                    className="logs-source-compare"
                    aria-label={`Compare logs for ${container.name}`}
                    title="Open in comparison pane"
                    onClick={() => openSource(source, true)}
                  >
                    <Columns2 size={13} />
                  </button>
                </div>
              );
            })}
            {containers && visibleContainers.length === 0 && (
              <p className="logs-source-placeholder">
                {containers.length
                  ? "No matching containers"
                  : "No containers found"}
              </p>
            )}
          </nav>
          <footer className="logs-sources-footer">
            <Server size={13} />
            <span>Docker containers</span>
            <span>{running === undefined ? "—" : `${running} running`}</span>
          </footer>
        </aside>
        <div className="logs-reader">
          <div
            className="logs-tabs"
            ref={tabsRef}
            role="tablist"
            aria-label="Open log sources"
          >
            {tabs.map((tab) => {
              const source = resolveSource(tab);
              return (
                <div
                  className={`logs-tab ${active.id === tab.id ? "is-active" : ""}`}
                  key={tab.id}
                >
                  <button
                    role="tab"
                    aria-selected={active.id === tab.id}
                    title={source.name}
                    onClick={() => setActiveId(tab.id)}
                  >
                    {tab.kind === "container" ? (
                      <Box size={13} />
                    ) : (
                      <FileText size={13} />
                    )}
                    <span>{source.name}</span>
                  </button>
                  {tabs.length > 1 && (
                    <button
                      className="logs-tab-close"
                      aria-label={`Close ${source.name} logs tab`}
                      onClick={() => closeTab(tab.id)}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="logs-toolbar">
            <label className="logs-find">
              <Search size={14} />
              <input
                ref={searchRef}
                aria-label="Find in logs"
                placeholder="Find in logs…"
                maxLength={200}
                value={filters.search}
                onChange={(event) =>
                  setFilters((previous) => ({
                    ...previous,
                    search: event.target.value,
                  }))
                }
              />
              {filters.search && (
                <button
                  aria-label="Clear log search"
                  onClick={() =>
                    setFilters((previous) => ({ ...previous, search: "" }))
                  }
                >
                  <X size={13} />
                </button>
              )}
              <button
                aria-label="Match case"
                aria-pressed={filters.matchCase}
                title="Match case"
                onClick={() =>
                  setFilters((previous) => ({
                    ...previous,
                    matchCase: !previous.matchCase,
                  }))
                }
              >
                <CaseSensitive size={16} />
              </button>
              <button
                aria-label="Exclude matching log lines"
                aria-pressed={filters.exclude}
                title="Exclude matches"
                onClick={() =>
                  setFilters((previous) => ({
                    ...previous,
                    exclude: !previous.exclude,
                  }))
                }
              >
                <ListFilter size={16} />
              </button>
            </label>
            <div className="logs-level-filters" aria-label="Log levels">
              <Filter size={13} />
              {LOG_LEVELS.map((level) => (
                <button
                  key={level}
                  className={`logs-level-filter logs-level-${level.toLowerCase()}`}
                  aria-label={`Toggle ${level} logs`}
                  aria-pressed={filters.levels.includes(level)}
                  onClick={() => toggleLevel(level)}
                >
                  <i />
                  {level}
                </button>
              ))}
            </div>
            <div className="logs-reader-tools">
              <button
                aria-label="Wrap log lines"
                title="Wrap lines"
                aria-pressed={filters.wrap}
                onClick={() =>
                  setFilters((previous) => ({
                    ...previous,
                    wrap: !previous.wrap,
                  }))
                }
              >
                <WrapText size={16} />
              </button>
              <button
                aria-label="Refresh all log panes"
                title="Refresh"
                onClick={() => setRefresh((value) => value + 1)}
              >
                <RefreshCw size={15} />
              </button>
              <button
                aria-label="Log display settings"
                title="Display settings"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen(!settingsOpen)}
              >
                <Settings2 size={16} />
              </button>
            </div>
          </div>
          {settingsOpen && (
            <div className="logs-display-settings">
              <label>
                <input
                  type="checkbox"
                  checked={filters.timestamps}
                  onChange={(event) =>
                    setFilters((previous) => ({
                      ...previous,
                      timestamps: event.target.checked,
                    }))
                  }
                />{" "}
                Timestamps (UTC)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={filters.lineNumbers}
                  onChange={(event) =>
                    setFilters((previous) => ({
                      ...previous,
                      lineNumbers: event.target.checked,
                    }))
                  }
                />{" "}
                Line numbers
              </label>
              <label>
                Text size
                <select
                  aria-label="Log text size"
                  value={filters.fontSize}
                  onChange={(event) =>
                    setFilters((previous) => ({
                      ...previous,
                      fontSize: Number(event.target.value),
                    }))
                  }
                >
                  {[11, 12, 13, 14, 16].map((size) => (
                    <option value={size} key={size}>
                      {size}px
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Page size
                <select
                  aria-label="Container log tail"
                  value={filters.tail}
                  onChange={(event) =>
                    setFilters((previous) => ({
                      ...previous,
                      tail: Number(event.target.value),
                    }))
                  }
                >
                  {[100, 500, 1000].map((count) => (
                    <option key={count} value={count}>
                      {count} lines
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={() => setFilters(defaultFilters)}>
                <ArrowDownWideNarrow size={13} /> Reset display
              </button>
              <button
                aria-label="Close log display settings"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="logs-history-controls">
            <button
              aria-expanded={rangeOpen}
              onClick={() => setRangeOpen(!rangeOpen)}
            >
              <Filter size={13} /> Host history filters
            </button>
            <span>
              {filters.since || filters.until || filters.unit
                ? "Journal / event range active"
                : "Journal history · host files · Docker events"}
            </span>
            <span>
              {active.kind === "all"
                ? "Recent journal + containers. Select a source to browse history."
                : "Search and level filters apply to the displayed page."}
            </span>
          </div>
          {rangeOpen && (
            <form
              className="logs-history-form"
              onSubmit={(event) => {
                event.preventDefault();
                const since = rangeDraft.since
                  ? new Date(rangeDraft.since).toISOString()
                  : "";
                const until = rangeDraft.until
                  ? new Date(rangeDraft.until).toISOString()
                  : "";
                if (since && until && since >= until) {
                  setNotice("Start must precede end.");
                  return;
                }
                setFilters((current) => ({
                  ...current,
                  since,
                  until,
                  unit: rangeDraft.unit.trim(),
                }));
                setRangeOpen(false);
              }}
            >
              <label>
                From (local time)
                <input
                  aria-label="Host logs from"
                  type="datetime-local"
                  value={rangeDraft.since}
                  onChange={(event) =>
                    setRangeDraft((value) => ({
                      ...value,
                      since: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Until (local time)
                <input
                  aria-label="Host logs until"
                  type="datetime-local"
                  value={rangeDraft.until}
                  onChange={(event) =>
                    setRangeDraft((value) => ({
                      ...value,
                      until: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Systemd unit
                <input
                  aria-label="Journal unit"
                  placeholder="e.g. ssh.service"
                  maxLength={256}
                  value={rangeDraft.unit}
                  onChange={(event) =>
                    setRangeDraft((value) => ({
                      ...value,
                      unit: event.target.value,
                    }))
                  }
                />
              </label>
              <button type="submit">Apply history filters</button>
              <button
                type="button"
                onClick={() => {
                  setRangeDraft({ since: "", until: "", unit: "" });
                  setFilters((value) => ({
                    ...value,
                    since: "",
                    until: "",
                    unit: "",
                  }));
                }}
              >
                Clear
              </button>
              <p>
                Time bounds apply to journal and Docker events; unit applies to
                journal. Files retain their original ordering. Previous entries
                depend on host retention and read permissions.
              </p>
            </form>
          )}
          {notice && (
            <div className="logs-notice" role="status">
              {notice}
              <button
                aria-label="Dismiss log notice"
                onClick={() => setNotice("")}
              >
                <X size={13} />
              </button>
            </div>
          )}
          <div className={`logs-panes ${split && compare ? "is-split" : ""}`}>
            <LogPane
              key={`${active.id}:${filters.since}:${filters.until}:${filters.unit}`}
              source={active}
              following={following}
              filters={filters}
              cache={cache.current}
              refresh={refresh}
              canRead={canRead}
            />
            {split && compare && (
              <LogPane
                key={`compare:${compare.id}:${filters.since}:${filters.until}:${filters.unit}`}
                source={compare}
                following={following}
                filters={filters}
                cache={cache.current}
                refresh={refresh}
                canRead={canRead}
              />
            )}
          </div>
          <footer className="logs-workspace-footer">
            <span
              className={`logs-follow-status ${following ? "is-live" : ""}`}
            >
              <i />
              {following ? "Automatic refresh enabled" : "Log updates paused"}
            </span>
            <span>Read only · buffered output</span>
            <span className="logs-shortcut">Ctrl / ⌘ F to find</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
