import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileText,
  RefreshCw,
} from "lucide-react";
import { getLogs } from "../lib/api";
import {
  cleanLogMessage,
  copyLogText,
  downloadLogEntries,
  logText,
  logTime,
  normalizedLevel,
  type LogSource,
} from "../lib/logs";
import type { LogEntry, LogsOverview } from "../lib/types";

export type LogFilters = {
  search: string;
  matchCase: boolean;
  exclude: boolean;
  levels: string[];
  wrap: boolean;
  timestamps: boolean;
  lineNumbers: boolean;
  fontSize: number;
  tail: number;
  since: string;
  until: string;
  unit: string;
};
export type LogCache = Map<string, LogsOverview>;

function Highlight({
  text,
  query,
  matchCase,
}: {
  text: string;
  query: string;
  matchCase: boolean;
}) {
  if (!query) return <>{text}</>;
  const index = (matchCase ? text : text.toLowerCase()).indexOf(
    matchCase ? query : query.toLowerCase(),
  );
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}
function LogRow({
  entry,
  index,
  filters,
  showSource,
  showDate,
}: {
  entry: LogEntry;
  index: number;
  filters: LogFilters;
  showSource: boolean;
  showDate: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const message = cleanLogMessage(entry.message);
  const level = normalizedLevel(entry.level);
  const json = useMemo(() => {
    try {
      const value: unknown = JSON.parse(message);
      return value !== null && typeof value === "object"
        ? JSON.stringify(value, null, 2)
        : null;
    } catch {
      return null;
    }
  }, [message]);
  const copy = async () => {
    try {
      await copyLogText(logText(entry));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to copy log line",
      );
    }
  };
  return (
    <div
      className={`logs-row logs-level-${level.toLowerCase()} ${expanded ? "is-expanded" : ""}`}
      role="listitem"
      data-log-level={level}
    >
      {filters.lineNumbers && (
        <span className="logs-line-number">{index + 1}</span>
      )}
      {filters.timestamps && (
        <time
          className="logs-timestamp"
          title={entry.timestamp || "Timestamp unavailable"}
          dateTime={entry.timestamp || undefined}
        >
          {showDate && entry.timestamp ? (
            <small>{entry.timestamp.slice(0, 10)}</small>
          ) : null}
          {logTime(entry.timestamp)}
        </time>
      )}
      <span
        className="logs-level-dot"
        title={`${level}${entry.stream ? ` · ${entry.stream}` : ""}`}
        aria-label={`${level} log line`}
      />
      <div className="logs-message-cell">
        <div className="logs-message-content">
          {showSource && (
            <span className="logs-origin" title={entry.source}>
              {entry.source}
            </span>
          )}
          {json && (
            <button
              className="logs-json-toggle"
              aria-label={`${expanded ? "Collapse" : "Expand"} JSON line ${index + 1}`}
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              <ChevronRight size={12} />
            </button>
          )}
          <span className="logs-message">
            <Highlight
              text={message}
              query={filters.exclude ? "" : filters.search}
              matchCase={filters.matchCase}
            />
          </span>
        </div>
        {expanded && json && <pre className="logs-json-detail">{json}</pre>}
        {error && (
          <span role="alert" className="logs-copy-error">
            {error}
          </span>
        )}
      </div>
      <button
        className="logs-copy-line"
        aria-label={`Copy log line ${index + 1}`}
        title="Copy line"
        onClick={() => void copy()}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

export default function LogPane({
  source,
  following,
  filters,
  cache,
  refresh,
  canRead,
}: {
  source: LogSource;
  following: boolean;
  filters: LogFilters;
  cache: LogCache;
  refresh: number;
  canRead: boolean;
}) {
  const journal = source.kind === "system";
  const timed = journal || source.kind === "events";
  const cacheKey = `${source.id}:${timed ? filters.since + ":" + filters.until : ""}:${journal ? filters.unit : ""}`;
  const [cursor, setCursor] = useState<string | undefined>();
  const archive = source.filePath?.endsWith(".gz") ?? false;
  const live = following && !cursor && !archive && !(timed && filters.until);
  const [data, setData] = useState<LogsOverview | null>(
    () => cache.get(cacheKey) || null,
  );
  const [loading, setLoading] = useState(!cache.has(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(0);
  const viewer = useRef<HTMLDivElement>(null);
  const completedRequest = useRef<string | null>(null);
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (!canRead || !visible) {
      setRefreshing(false);
      return;
    }
    const requestKey = `${cacheKey}:${filters.tail}:${refresh}:${manualRefresh}:${cursor || ""}`;
    if (!live && completedRequest.current === requestKey) {
      setRefreshing(false);
      return;
    }
    const controller = new AbortController();
    let timer: number | undefined;
    const load = async () => {
      setRefreshing(true);
      try {
        const next = await getLogs({
          containerId: source.containerId,
          system: journal,
          filePath: source.filePath,
          category: source.category,
          events: source.kind === "events",
          cursor,
          since: timed ? filters.since : undefined,
          until: timed ? filters.until : undefined,
          unit: journal ? filters.unit : undefined,
          tail: filters.tail,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!cursor) {
          if (cache.size >= 16 && !cache.has(cacheKey))
            cache.delete(cache.keys().next().value!);
          cache.set(cacheKey, next);
        }
        setData(next);
        setError("");
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Unable to load logs",
          );
      } finally {
        if (!controller.signal.aborted) {
          completedRequest.current = requestKey;
          setLoading(false);
          setRefreshing(false);
          if (live && visible)
            timer = window.setTimeout(() => void load(), 2000);
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    source.id,
    source.containerId,
    source.kind,
    live,
    journal,
    timed,
    cacheKey,
    cursor,
    source.filePath,
    source.category,
    filters.since,
    filters.until,
    filters.unit,
    visible,
    filters.tail,
    refresh,
    manualRefresh,
    canRead,
    cache,
  ]);
  const entries = data?.entries ?? [];
  const filtered = useMemo(() => {
    const query = filters.matchCase
      ? filters.search
      : filters.search.toLowerCase();
    return entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        if (!filters.levels.includes(normalizedLevel(entry.level)))
          return false;
        if (!query) return true;
        const text = cleanLogMessage(entry.message) + " " + entry.source;
        const matches = (
          filters.matchCase ? text : text.toLowerCase()
        ).includes(query);
        return filters.exclude ? !matches : matches;
      });
  }, [
    entries,
    filters.search,
    filters.matchCase,
    filters.exclude,
    filters.levels,
  ]);
  useEffect(() => {
    if (autoScroll && viewer.current)
      viewer.current.scrollTop = viewer.current.scrollHeight;
  }, [data, filtered.length, autoScroll]);
  const copy = async () => {
    try {
      await copyLogText(filtered.map(({ entry }) => logText(entry)).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to copy logs");
    }
  };
  const onScroll = useCallback(() => {
    const element = viewer.current;
    if (element)
      setAutoScroll(
        element.scrollHeight - element.scrollTop - element.clientHeight < 40,
      );
  }, []);
  const status = !canRead
    ? "Read restricted"
    : error
      ? "Unavailable"
      : loading
        ? "Loading"
        : cursor || archive || (timed && filters.until)
          ? "History"
          : live && visible
            ? "Auto-refresh · 2s"
            : "Paused";
  return (
    <section className="logs-pane" aria-label={`${source.name} logs`}>
      <header className="logs-pane-header">
        <div className="logs-pane-title">
          <FileText size={15} />
          <strong title={source.name}>{source.name}</strong>
          <span
            className={`logs-connection ${error ? "is-error" : live && visible ? "is-live" : ""}`}
          >
            <i />
            {status}
          </span>
        </div>
        <div className="logs-pane-actions">
          <button
            aria-label={`Refresh ${source.name} logs`}
            title="Refresh"
            onClick={() => setManualRefresh((value) => value + 1)}
          >
            <RefreshCw size={14} className={refreshing ? "logs-spin" : ""} />
          </button>
          <button
            aria-label={`Copy ${source.name} logs`}
            title="Copy displayed lines"
            disabled={!filtered.length}
            onClick={() => void copy()}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            aria-label={`Download ${source.name} logs`}
            title="Download displayed lines"
            disabled={!filtered.length}
            onClick={() =>
              downloadLogEntries(
                filtered.map(({ entry }) => entry),
                source.name,
              )
            }
          >
            <Download size={14} />
          </button>
        </div>
      </header>
      {error && (
        <div className="logs-error" role="alert">
          <AlertCircle size={15} />
          <span>
            {error}
            {data ? " Showing the last successful snapshot." : ""}
          </span>
        </div>
      )}
      {data?.warnings?.length ? (
        <details className="logs-warnings">
          <summary>
            {data.warnings.length} source{" "}
            {data.warnings.length === 1 ? "warning" : "warnings"}
          </summary>
          {data.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </details>
      ) : null}
      <div
        ref={viewer}
        className={`logs-output ${filters.wrap ? "is-wrapped" : ""} ${!filters.timestamps ? "hide-timestamps" : ""} ${!filters.lineNumbers ? "hide-line-numbers" : ""}`}
        style={{ fontSize: filters.fontSize }}
        onScroll={onScroll}
        tabIndex={0}
        aria-label={`${source.name} log output`}
      >
        {!canRead ? (
          <div className="logs-empty">
            <AlertCircle size={28} />
            <strong>Operator access required</strong>
            <p>Sign in as an operator or administrator to read logs.</p>
          </div>
        ) : loading ? (
          <div className="logs-empty" role="status">
            <RefreshCw size={24} className="logs-spin" />
            <p>Loading logs…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="logs-empty">
            <FileText size={30} />
            <strong>
              {entries.length ? "No matching log lines" : "No log entries yet"}
            </strong>
            <p>
              {entries.length
                ? "Adjust your search or level filters."
                : "Output will appear here when this source writes logs."}
            </p>
          </div>
        ) : (
          <div role="list" aria-label="Log lines">
            {filtered.map(({ entry, index }) => (
              <LogRow
                key={`${index}:${entry.timestamp}:${entry.message}`}
                entry={entry}
                index={index}
                filters={filters}
                showDate={journal || !!cursor || archive}
                showSource={source.kind === "all" || journal}
              />
            ))}
          </div>
        )}
      </div>
      {!autoScroll && filtered.length > 0 && (
        <button
          className="logs-jump"
          onClick={() => {
            setAutoScroll(true);
            viewer.current?.scrollTo({
              top: viewer.current.scrollHeight,
              behavior: "smooth",
            });
          }}
        >
          <ArrowDown size={14} /> Jump to latest
        </button>
      )}
      {(journal || source.kind === "file") && (
        <div className="logs-history-pagination">
          <button
            disabled={!data?.nextCursor || refreshing || !canRead}
            onClick={() => {
              setCursor(data!.nextCursor);
              setAutoScroll(false);
            }}
          >
            {data?.historyOrder === "newer"
              ? "Next archive page"
              : "Older entries"}
          </button>
          {(cursor || archive) && (
            <button
              disabled={refreshing}
              onClick={() => {
                setCursor(undefined);
                setManualRefresh((value) => value + 1);
                setAutoScroll(true);
              }}
            >
              {archive ? "Archive start" : "Return to latest"}
            </button>
          )}
          <span>
            {refreshing
              ? "Reading page…"
              : data?.nextCursor
                ? "More retained entries available"
                : "End of available records"}
          </span>
        </div>
      )}
      <footer className="logs-pane-footer">
        <span>
          {filtered.length.toLocaleString()} / {entries.length.toLocaleString()}{" "}
          lines
        </span>
        <span>
          {data?.truncated
            ? "Output truncated"
            : source.kind === "all"
              ? "Aggregate · up to 500"
              : source.kind === "system"
                ? `Journal · ${filters.tail} per page`
                : `Latest ${filters.tail} requested`}
        </span>
        <span className="logs-updated">
          Updated {logTime(data?.updatedAt || "")} UTC
        </span>
      </footer>
    </section>
  );
}
