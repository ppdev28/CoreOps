import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardHeader, Btn } from "./ui";
import {
  getSecurityEvents,
  getSecurityMonitor,
  resetSecurityMonitor,
  type SecurityEventPage,
  type SecurityMonitor,
} from "../lib/security";
import { getSession } from "../lib/auth";
import type { ConfirmDialog } from "../lib/types";
export default function SecurityJournal({
  legacyWarning,
  onConfirm,
}: {
  legacyWarning: string;
  onConfirm: (dialog: ConfirmDialog) => void;
}) {
  const admin = getSession()?.user.role === "admin";
  const [category, setCategory] = useState("all"),
    [page, setPage] = useState<SecurityEventPage | null>(null),
    [monitor, setMonitor] = useState<SecurityMonitor | null>(null),
    [error, setError] = useState(""),
    [monitorError, setMonitorError] = useState(""),
    [busy, setBusy] = useState(false),
    [live, setLive] = useState(true),
    [query, setQuery] = useState("");
  const reader = useRef<AbortController | null>(null),
    current = useRef<SecurityEventPage | null>(null),
    locked = useRef(false),
    generation = useRef(0);
  const read = useCallback(
    async (direction = "older", cursor = "") => {
      if (locked.current) return;
      locked.current = true;
      setBusy(true);
      const c = new AbortController();
      reader.current = c;
      const gen = generation.current;
      try {
        const next = await getSecurityEvents(
          category,
          cursor,
          direction,
          c.signal,
        );
        if (c.signal.aborted || gen !== generation.current) return;
        if (!Array.isArray(next.events) || !next.source)
          throw new Error("Journal pagination is not supported by this API");
        if (next.source.state !== "ok" && next.source.state !== "partial")
          throw new Error(next.source.detail || "Journal evidence unavailable");
        if (next.events.length || !cursor) {
          setPage(next);
          current.current = next;
        }
        setError(
          next.source.state === "partial"
            ? next.source.detail || "Some journal evidence could not be decoded"
            : "",
        );
      } catch (e) {
        if (!c.signal.aborted && gen === generation.current)
          setError(e instanceof Error ? e.message : "Journal read failed");
      } finally {
        if (gen === generation.current) {
          locked.current = false;
          setBusy(false);
        }
      }
    },
    [category],
  );
  useEffect(() => {
    generation.current++;
    reader.current?.abort();
    locked.current = false;
    current.current = null;
    setPage(null);
    setError("");
    void read();
    return () => {
      generation.current++;
      reader.current?.abort();
      locked.current = false;
    };
  }, [read]);
  const refreshMonitor = useCallback(async (signal?: AbortSignal) => {
    try {
      const m = await getSecurityMonitor(signal);
      if (signal?.aborted) return;
      if (!Array.isArray(m.signals)) throw new Error("Monitor unavailable");
      setMonitor(m);
      setMonitorError("");
    } catch (e) {
      if (!signal?.aborted)
        setMonitorError(e instanceof Error ? e.message : "Monitor unavailable");
    }
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void refreshMonitor(c.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshMonitor(c.signal);
    }, 10000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [refreshMonitor]);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        current.current?.newestCursor
      )
        void read("newer", current.current.newestCursor);
    }, 10000);
    return () => clearInterval(timer);
  }, [live, read]);
  const reset = () =>
    onConfirm({
      title: "Reset Security journal checkpoint",
      action: "Acknowledge gap and reset",
      danger: true,
      requireConfirmation: true,
      message:
        "Reset the monitor to the latest retained journal window. This acknowledges a coverage gap; earlier events remain in the system journal if retained. No host service or firewall will change.",
      onConfirm: () => {
        void resetSecurityMonitor()
          .then(() => refreshMonitor())
          .catch((e) =>
            setMonitorError(e.message || "Checkpoint reset failed"),
          );
      },
    });
  const events = (page?.events || []).filter((e) =>
    `${e.message} ${e.source || ""}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  return (
    <Card>
      <CardHeader title="Security journal and signals" />
      <div className="security-items security-evidence">
        <div className="security-monitor">
          <h3>Continuous journal monitor</h3>
          {monitorError && (
            <p role="alert" className="security-warning">
              {monitorError}. Previous monitor state may be stale.
            </p>
          )}
          {monitor && (
            <>
              <p>
                <strong>{monitor.state}</strong> · {monitor.detail}
              </p>
              <p>
                Last collected: {monitor.lastCollected || "Not yet reported"} ·
                Coverage starts: {monitor.coverageSince || "Not yet reported"} ·{" "}
                {monitor.retainedEvents} events in the correlation window
              </p>
              {monitor.backlog && (
                <p className="security-warning">
                  A backlog remains. Collection will continue from the saved
                  cursor.
                </p>
              )}
              {admin && ["error", "partial"].includes(monitor.state) && (
                <Btn size="sm" onClick={reset}>
                  Review checkpoint reset
                </Btn>
              )}
              <h4>Observed signals</h4>
              {monitor.signals.length ? (
                monitor.signals.map((s) => (
                  <article className="security-signal" key={s.id}>
                    <strong>
                      {s.severity} · {s.rule}
                    </strong>
                    <p>{s.summary}</p>
                    <p>
                      {s.observedAt
                        ? new Date(s.observedAt).toLocaleString() + " · "
                        : ""}
                      {s.count} evidence records ·{" "}
                      {s.evidenceIds
                        .slice(0, 3)
                        .map((id) => id.slice(0, 12))
                        .join(", ")}
                    </p>
                  </article>
                ))
              ) : (
                <p>
                  No rules matched the currently retained evidence. This does
                  not mean the host is free of threats.
                </p>
              )}
            </>
          )}
        </div>
        <p>
          Browse retained journal pages without the previous 120-record limit.
          Kernel, audit, Tailscale, authentication and sensor logs are included
          when the account can read them. Live refresh pauses while browsing
          older pages.
        </p>
        {legacyWarning && <p className="security-warning">{legacyWarning}</p>}
        <div className="security-filter-grid">
          <label>
            Event source
            <select
              aria-label="Security event source"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setLive(true);
              }}
            >
              {[
                ["all", "All security sources"],
                ["ssh", "OpenSSH"],
                ["tailscale", "Tailscale"],
                ["kernel", "Kernel / firewall"],
                ["audit", "Linux Audit"],
                ["auth", "Authentication / sudo"],
                ["sensors", "Detection sensors"],
              ].map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search this page
            <input
              aria-label="Search security journal page"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Message or source…"
            />
          </label>
          <label className="security-checkbox">
            <input
              type="checkbox"
              aria-label="Live security journal"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
            />
            Live journal refresh
          </label>
          <Btn
            size="sm"
            disabled={busy}
            onClick={() => {
              setLive(true);
              void read();
            }}
          >
            Latest page
          </Btn>
        </div>
        {error && (
          <p role="alert" className="security-warning">
            {error}
            {page ? " Previous journal page remains visible." : ""}
          </p>
        )}
        <div className="security-event-list" aria-busy={busy}>
          {events.map((e, i) => (
            <article
              className="security-event"
              key={e.id || `${e.timestamp}-${i}`}
            >
              <time dateTime={e.timestamp}>
                {new Date(e.timestamp).toLocaleString()}
              </time>
              <strong>{e.type}</strong>
              <span> · {e.source || "Journal"}</span>
              <p>{e.message}</p>
              {e.truncated && (
                <p>Message truncated; inspect the original journal entry.</p>
              )}
            </article>
          ))}
          {!events.length && !error && (
            <p>
              {busy
                ? "Reading journal…"
                : page?.events.length
                  ? "No matches in this page."
                  : "No records returned for this source and page; coverage is not exhaustive."}
            </p>
          )}
        </div>
        <div className="security-pagination">
          <span>{page?.events.length || 0} records in this page</span>
          <Btn
            size="sm"
            disabled={busy || !page?.oldestCursor}
            onClick={() => {
              setLive(false);
              void read("older", page!.oldestCursor);
            }}
          >
            Older events
          </Btn>
          <Btn
            size="sm"
            disabled={busy || !page?.newestCursor}
            onClick={() => {
              setLive(false);
              void read("newer", page!.newestCursor);
            }}
          >
            Newer events
          </Btn>
        </div>
      </div>
    </Card>
  );
}
