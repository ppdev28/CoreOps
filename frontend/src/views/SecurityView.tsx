import { useCallback, useEffect, useRef, useState } from "react";
import { Shield, RefreshCw, TerminalSquare, Lock } from "lucide-react";
import { T } from "../lib/tokens";
import { Card, CardHeader, Btn } from "../components/ui";
import { getSession } from "../lib/auth";
import {
  fixSecurityItem,
  getSecurity,
  terminateSecuritySession,
} from "../lib/api";
import type {
  ConfirmDialog,
  SecurityOverview,
  SecuritySession,
  ToastType,
} from "../lib/types";
import "../styles/security.css";

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value || "Unavailable"
    : parsed.toLocaleString();
}
function sourceMessage(data: SecurityOverview, key: string) {
  const source = data.sources[key];
  return !source || source.state === "ok"
    ? ""
    : `${source.state.replaceAll("_", " ")}: ${source.detail || "Source unavailable"}`;
}
export default function SecurityView({
  addToast,
  onConfirm,
}: {
  addToast: (message: string, type: ToastType) => void;
  onConfirm: (dialog: ConfirmDialog) => void;
}) {
  const admin = getSession()?.user.role === "admin";
  const [data, setData] = useState<SecurityOverview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setRefreshing(true);
    try {
      const response = await getSecurity(next.signal);
      if (next.signal.aborted) return;
      setData(response);
      setError("");
      // An accepted signal is not evidence of termination. Only a complete inventory can confirm absence.
      if (response.sources.sessions?.state === "ok") {
        setPending((old) =>
          Object.fromEntries(
            Object.entries(old).map(([id, label]) => [
              id,
              response.sessions.some((s) => s.id === id)
                ? label
                : "Closed — verified by refreshed SSH inventory",
            ]),
          ),
        );
      }
    } catch (e) {
      if (!next.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Security sources could not be read",
        );
    } finally {
      if (!next.signal.aborted) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [load, autoRefresh]);
  const terminate = (session: SecuritySession) =>
    onConfirm({
      title: "Terminate SSH session",
      action: "Terminate session",
      danger: true,
      requireConfirmation: true,
      message: `Send SIGTERM to ${session.user} · ${session.terminal || "no PTY"} · PID ${session.pid}, from ${session.from || "unknown origin"}? All channels owned by this SSH process may close. Session ${session.id.slice(0, 12)}.`,
      onConfirm: () => {
        void (async () => {
          setBusy(true);
          setActionError("");
          try {
            await terminateSecuritySession(session);
            if (!mounted.current) return;
            setPending((old) => ({
              ...old,
              [session.id]:
                "Termination requested — waiting for a complete inventory",
            }));
            addToast("SSH termination requested", "info");
            await load();
          } catch (e) {
            if (mounted.current)
              setActionError(
                e instanceof Error ? e.message : "SSH termination failed",
              );
          } finally {
            if (mounted.current) setBusy(false);
          }
        })();
      },
    });
  const enableUpdates = () =>
    onConfirm({
      title: "Enable automatic updates",
      action: "Enable upgrade timer",
      requireConfirmation: true,
      message:
        "Enable and start apt-daily-upgrade.timer on this server. Its next run can install packages according to the existing APT policy. CoreOps will read back the effective policy and timer status.",
      onConfirm: () => {
        void (async () => {
          setBusy(true);
          setActionError("");
          try {
            await fixSecurityItem("auto-updates");
            if (!mounted.current) return;
            addToast("Automatic update scheduling verified", "success");
            await load();
          } catch (e) {
            if (mounted.current)
              setActionError(
                e instanceof Error
                  ? e.message
                  : "Unable to verify automatic update scheduling",
              );
          } finally {
            if (mounted.current) setBusy(false);
          }
        })();
      },
    });
  const passed = data?.checks.filter((c) => c.ok === true).length || 0;
  const attention = data?.checks.filter((c) => c.ok === false).length || 0;
  const unknown =
    data?.checks.filter((c) => c.status !== "info" && c.ok === null).length ||
    0;
  return (
    <div className="security-view" style={{ color: T.text }}>
      <header className="security-header">
        <div>
          <h1>Security</h1>
          <p>
            Host policy, OpenSSH and Tailscale SSH sessions, and security
            journal.
          </p>
        </div>
        <div className="security-controls">
          <label>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />{" "}
            Refresh every 15s
          </label>
          <Btn size="sm" disabled={refreshing} onClick={() => void load()}>
            <RefreshCw size={13} /> {refreshing ? "Refreshing…" : "Refresh"}
          </Btn>
        </div>
      </header>
      {error && (
        <div role="alert" className="security-warning">
          {error}
          {data && ` · Showing older data from ${date(data.updatedAt)}`}
        </div>
      )}
      {actionError && (
        <div role="alert" className="security-warning">
          {actionError}
        </div>
      )}
      {!data && (
        <p role="status">
          {refreshing
            ? "Loading security evidence…"
            : "Security data unavailable"}
        </p>
      )}
      {data && (
        <>
          <div className="security-summary" aria-live="polite">
            <Card>
              <div className="security-summary-item">
                <Shield size={18} />
                <strong>
                  {passed} passed · {attention} need attention
                </strong>
                <span>{unknown} unknown checks</span>
              </div>
            </Card>
            <Card>
              <div className="security-summary-item">
                <Lock size={18} />
                <strong>
                  Firewall:{" "}
                  {data.firewallActive === null
                    ? "Unknown"
                    : data.firewallActive
                      ? "Active"
                      : "Inactive"}
                </strong>
                <span>Live UFW state</span>
              </div>
            </Card>
            <Card>
              <div className="security-summary-item">
                <TerminalSquare size={18} />
                <strong>
                  {data.sources.sessions?.state === "ok"
                    ? data.sessions.length
                    : "Incomplete"}{" "}
                  SSH sessions
                </strong>
                <span>OpenSSH and Tailscale SSH terminals</span>
              </div>
            </Card>
          </div>
          <p className="security-updated">
            {refreshing
              ? "Updating; previous evidence remains visible. "
              : error
                ? "Stale evidence. "
                : "Last collected: "}
            {date(data.updatedAt)}. Checks describe configuration evidence, not
            a security certification.
          </p>
          {!admin && (
            <p className="security-notice">
              Read-only access. Administrative actions require the CoreOps admin
              role and host permissions.
            </p>
          )}
          <div className="security-columns">
            <Card>
              <CardHeader title="Security checks" />
              <div className="security-items">
                {data.checks.map((check) => (
                  <div className="security-check" key={check.id || check.label}>
                    <div className="security-check-title">
                      <strong>{check.label}</strong>
                      <span
                        style={{
                          color:
                            check.ok === true
                              ? T.green
                              : check.ok === false
                                ? T.yellow
                                : T.textDim,
                        }}
                      >
                        {check.ok === true
                          ? "Pass"
                          : check.ok === false
                            ? "Needs attention"
                            : check.status === "info"
                              ? "Information"
                              : "Unknown"}
                      </span>
                    </div>
                    <p>{check.detail}</p>
                    {check.id === "auto-updates" &&
                      check.ok === false &&
                      admin && (
                        <>
                          <Btn
                            size="sm"
                            disabled={
                              busy ||
                              refreshing ||
                              !!error ||
                              !data.capabilities.autoUpdates?.available
                            }
                            onClick={enableUpdates}
                          >
                            Enable upgrade timer
                          </Btn>
                          {!data.capabilities.autoUpdates?.available && (
                            <p>
                              {data.capabilities.autoUpdates?.reason ||
                                "Host permission unavailable"}
                            </p>
                          )}
                        </>
                      )}
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title="Active SSH sessions" />
              <div className="security-items">
                {sourceMessage(data, "sessions") && (
                  <p role="status" className="security-warning">
                    {sourceMessage(data, "sessions")}
                  </p>
                )}
                {data.sessions.length === 0 && (
                  <p>
                    {data.sources.sessions?.state === "ok"
                      ? "No supported active SSH sessions detected."
                      : "A complete SSH inventory is unavailable."}
                  </p>
                )}
                {data.sessions.map((session) => (
                  <article className="security-session" key={session.id}>
                    <div className="security-check-title">
                      <strong>
                        {session.name ||
                          `${session.user} · ${session.terminal || "no PTY"}`}
                      </strong>
                      <span>
                        {session.method === "Tailscale SSH"
                          ? "Tailscale SSH · view only"
                          : session.verified
                            ? "Verified OpenSSH"
                            : "Unverified"}
                      </span>
                    </div>
                    <dl>
                      <dt>User</dt>
                      <dd>
                        {session.user} (UID {session.uid})
                      </dd>
                      <dt>Terminal</dt>
                      <dd>
                        {session.terminal || "No PTY / forwarding session"}
                      </dd>
                      <dt>Origin</dt>
                      <dd>{session.from || "Unavailable"}</dd>
                      <dt>Login time</dt>
                      <dd>
                        {session.since
                          ? `${date(session.since)} (${session.sinceSource || "reported"})`
                          : "Unavailable"}
                      </dd>
                      <dt>Process</dt>
                      <dd>
                        {session.process || "sshd"} · PID {session.pid} · parent{" "}
                        {session.parentPid}
                      </dd>
                      <dt>Session ID</dt>
                      <dd title={session.id}>
                        {session.id.slice(0, 12)}
                        {session.loginId ? ` · logind ${session.loginId}` : ""}
                      </dd>
                    </dl>
                    {admin && (
                      <Btn
                        size="sm"
                        disabled={
                          busy ||
                          refreshing ||
                          !!error ||
                          !session.verified ||
                          !session.canTerminate ||
                          !!pending[session.id]
                        }
                        onClick={() => terminate(session)}
                      >
                        Terminate session
                      </Btn>
                    )}
                    {!session.canTerminate && (
                      <p>
                        {session.terminationReason ||
                          "The host could not verify permission to terminate this session."}
                      </p>
                    )}
                    {pending[session.id] && (
                      <p role="status">{pending[session.id]}</p>
                    )}
                  </article>
                ))}
                {Object.entries(pending)
                  .filter(([id]) => !data.sessions.some((s) => s.id === id))
                  .map(([id, status]) => (
                    <p role="status" key={id}>
                      Session {id.slice(0, 12)}: {status}
                    </p>
                  ))}
                <p className="security-notice">
                  OpenSSH connections and active Tailscale SSH terminal logins
                  are shown. Closing a session affects its remote user.
                  Tailscale sessions are view only; forwarding-only Tailscale
                  connections and stale logind records are not included.
                </p>
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader title="Firewall rules" />
            <div className="security-items">
              {sourceMessage(data, "ufw") ? (
                <p role="status" className="security-warning">
                  {sourceMessage(data, "ufw")}
                </p>
              ) : (
                <>
                  <p>
                    {data.firewallVersion || "UFW"} ·{" "}
                    {data.firewallRules.length} rules read. Other firewalls and
                    external reachability are not assessed.
                  </p>
                  <Btn size="sm" onClick={() => setShowRules(!showRules)}>
                    {showRules ? "Hide rules" : "Show rules"}
                  </Btn>
                  {showRules &&
                    (data.firewallRules.length ? (
                      <div className="security-rules">
                        {data.firewallRules.map((rule, i) => (
                          <article className="security-rule" key={i}>
                            <strong>
                              {rule.number && `#${rule.number} `}
                              {rule.action}
                            </strong>
                            <dl>
                              <dt>To</dt>
                              <dd>{rule.to}</dd>
                              <dt>From</dt>
                              <dd>{rule.from}</dd>
                            </dl>
                            {rule.comment && <p>{rule.comment}</p>}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p>No UFW rules returned.</p>
                    ))}
                </>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Recent security events" />
            <div className="security-items">
              {sourceMessage(data, "events") && (
                <p role="status" className="security-warning">
                  {sourceMessage(data, "events")}
                </p>
              )}
              {data.events.length ? (
                data.events.map((event, i) => (
                  <article
                    className="security-event"
                    key={`${event.timestamp}-${i}`}
                  >
                    <time dateTime={event.timestamp}>
                      {date(event.timestamp)}
                    </time>
                    <span
                      style={{
                        color:
                          event.type === "error"
                            ? T.red
                            : event.type === "success"
                              ? T.green
                              : T.textDim,
                      }}
                    >
                      {event.type}
                    </span>
                    <p>{event.message}</p>
                  </article>
                ))
              ) : !sourceMessage(data, "events") ? (
                <p>
                  No events returned by the SSH/fail2ban system journal. This is
                  not a complete host security audit.
                </p>
              ) : null}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
