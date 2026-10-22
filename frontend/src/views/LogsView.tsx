import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Download, RefreshCw, AlertCircle } from "lucide-react";
import { T } from "../lib/tokens";
import { Card, Btn, Input, Select } from "../components/ui";
import { getLogs } from "../lib/api";
import type { LogEntry } from "../lib/types";
import { loadWebSettings, subscribeWebSettings } from "../lib/webSettings";

const LEVEL_COLOR: Record<string, string> = {
  INFO: "#22c55e",
  WARN: "#f59e0b",
  ERROR: "#ef4444",
  notice: "#3b82f6",
  access: "#8b92a5",
};
function formatUpdated(value: string) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString();
}

export default function LogsView() {
  const [entries, setEntries] = useState<LogEntry[]>([]),
    [sources, setSources] = useState<string[]>(["All"]),
    [search, setSearch] = useState(""),
    [level, setLevel] = useState("All"),
    [source, setSource] = useState("All"),
    [autoScroll, setAutoScroll] = useState(true),
    [follow, setFollow] = useState(true),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [updatedAt, setUpdatedAt] = useState(""),
    [settings, setSettings] = useState(loadWebSettings);
  const viewerRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await getLogs();
      setEntries(data.entries);
      setSources(data.sources.length ? data.sources : ["All"]);
      setUpdatedAt(data.updatedAt);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load logs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => subscribeWebSettings(setSettings), []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!follow || !settings.autoRefresh) return;
    const timer = window.setInterval(
      () => void load(true),
      settings.refreshSeconds * 1000,
    );
    return () => window.clearInterval(timer);
  }, [follow, settings.autoRefresh, settings.refreshSeconds, load]);
  const filtered = useMemo(
    () =>
      entries.filter((line) => {
        const q = search.toLowerCase();
        return (
          (!q ||
            line.message.toLowerCase().includes(q) ||
            line.source.toLowerCase().includes(q)) &&
          (level === "All" || line.level === level) &&
          (source === "All" || line.source === source)
        );
      }),
    [entries, search, level, source],
  );
  useEffect(() => {
    if (!autoScroll || !viewerRef.current || filtered.length === 0) return;
    viewerRef.current.scrollTop = viewerRef.current.scrollHeight;
  }, [filtered.length, autoScroll]);
  function downloadLogs() {
    const text = filtered
      .map(
        (line) =>
          `${line.timestamp} ${line.level.padEnd(5)} ${line.source.padEnd(18)} ${line.message}`,
      )
      .join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `coreops-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div
      style={{
        padding: "22px 24px",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <h1
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: T.text,
            letterSpacing: "-0.02em",
          }}
        >
          Logs
        </h1>
        <p style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
          Centralized log explorer ·{" "}
          {settings.autoRefresh && follow
            ? `refreshing every ${settings.refreshSeconds}s`
            : "manual refresh"}
          .
        </p>
      </div>
      <div
        style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}
      >
        {sources.map((item) => (
          <button
            key={item}
            onClick={() => setSource(item)}
            style={{
              padding: "4px 10px",
              background: source === item ? T.accent : T.raised,
              border: `1px solid ${source === item ? T.accent : T.border}`,
              borderRadius: 5,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 500,
              color: source === item ? "#fff" : T.textSub,
              fontFamily: "Inter,sans-serif",
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <Input
          value={search}
          onChange={setSearch}
          placeholder="Search logs…"
          icon={<Search size={12} />}
          style={{ flex: 1, maxWidth: 340 }}
        />
        <Select
          value={level}
          onChange={setLevel}
          options={["All", "INFO", "WARN", "ERROR", "notice", "access"].map(
            (v) => ({ label: v, value: v }),
          )}
        />
        <div style={{ flex: 1 }} />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            style={{ accentColor: T.accent }}
          />
          <span style={{ fontSize: 11, color: T.textDim }}>Auto-scroll</span>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
            style={{ accentColor: T.accent }}
          />
          <span style={{ fontSize: 11, color: T.textDim }}>Follow logs</span>
        </label>
        <Btn
          variant="ghost"
          size="xs"
          icon={<RefreshCw size={11} />}
          onClick={() => void load(true)}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </Btn>
        <Btn
          variant="ghost"
          size="xs"
          icon={<Download size={11} />}
          onClick={downloadLogs}
        >
          Download
        </Btn>
      </div>
      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 12px",
            marginBottom: 10,
            border: `1px solid ${T.red}40`,
            background: `${T.red}0d`,
            borderRadius: 7,
            color: T.red,
            fontSize: 11,
          }}
        >
          <AlertCircle size={13} />
          <span>{error}</span>
        </div>
      )}
      <Card
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          ref={viewerRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 16px",
            background: T.bg,
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 11.5,
            lineHeight: 1.9,
            minHeight: 400,
          }}
        >
          {loading ? (
            <div
              style={{ color: T.textDim, textAlign: "center", paddingTop: 40 }}
            >
              Loading logs…
            </div>
          ) : filtered.length === 0 ? (
            <div
              style={{ color: T.textDim, textAlign: "center", paddingTop: 40 }}
            >
              No log entries match your filters
            </div>
          ) : (
            filtered.map((line, i) => (
              <div
                key={`${line.timestamp}-${i}`}
                style={{
                  display: "flex",
                  gap: 14,
                  padding: "1px 0",
                  borderBottom: `1px solid ${T.borderMuted}10`,
                }}
              >
                <span
                  style={{
                    color: T.textDim,
                    flexShrink: 0,
                    userSelect: "none",
                    width: 156,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {line.timestamp}
                </span>
                <span
                  style={{
                    width: 52,
                    flexShrink: 0,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    color: LEVEL_COLOR[line.level] || T.textDim,
                  }}
                >
                  {line.level}
                </span>
                <span
                  style={{
                    width: 110,
                    flexShrink: 0,
                    color: T.textDim,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {line.source}
                </span>
                <span
                  style={{
                    color: T.textSub,
                    flex: 1,
                    overflowWrap: "anywhere",
                  }}
                >
                  {line.message}
                </span>
              </div>
            ))
          )}
        </div>
        <div
          style={{
            padding: "8px 16px",
            borderTop: `1px solid ${T.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: T.textDim,
              fontFamily: "JetBrains Mono,monospace",
            }}
          >
            {filtered.length} entries
          </span>
          <span style={{ fontSize: 10, color: T.textDim, marginLeft: 8 }}>
            Updated {formatUpdated(updatedAt)}
          </span>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: follow && settings.autoRefresh ? T.green : T.textDim,
              marginLeft: "auto",
            }}
            className={follow && settings.autoRefresh ? "pulse" : ""}
          />
          <span style={{ fontSize: 11, color: T.textDim }}>
            {follow && settings.autoRefresh ? "Live" : "Paused"}
          </span>
        </div>
      </Card>
    </div>
  );
}
