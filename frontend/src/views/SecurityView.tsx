import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Shield,
  Lock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  RefreshCw,
  Wifi,
  Clock,
  TerminalSquare,
} from "lucide-react";
import { T } from "../lib/tokens";
import { Card, CardHeader, Btn } from "../components/ui";
import {
  fixSecurityItem,
  getSecurity,
  terminateSecuritySession,
} from "../lib/api";
import type { SecurityOverview } from "../lib/types";

if (
  typeof document !== "undefined" &&
  !document.getElementById("coreops-sidebar-icon-hover-fix")
) {
  const style = document.createElement("style");
  style.id = "coreops-sidebar-icon-hover-fix";
  style.textContent = `
    aside > div:first-child > button:last-child{right:3px!important;top:26px!important;z-index:30!important}
    aside > div:first-child > div:first-child:hover ~ button:last-child,
    aside > div:first-child > button:last-child:hover{opacity:1!important;pointer-events:auto!important}
  `;
  document.head.appendChild(style);
}

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function SecurityView({
  addToast,
}: {
  addToast: (m: string, t: any) => void;
}) {
  const [data, setData] = useState<SecurityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busyPid, setBusyPid] = useState<number | null>(null);
  const [fixing, setFixing] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      setData(await getSecurity());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load security data",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const healthyChecks = useMemo(
    () => data?.checks.filter((c) => c.ok === true).length ?? 0,
    [data],
  );
  const failedChecks = useMemo(
    () => data?.checks.filter((c) => c.ok === false).length ?? 0,
    [data],
  );

  const killSession = async (pid: number) => {
    if (!window.confirm(`Terminate session PID ${pid}?`)) return;
    setBusyPid(pid);
    try {
      await terminateSecuritySession(pid);
      addToast(`Session ${pid} terminated`, "success");
      await load(true);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Unable to terminate session",
        "error",
      );
    } finally {
      setBusyPid(null);
    }
  };

  const fixUpdates = async () => {
    setFixing(true);
    try {
      await fixSecurityItem("auto-updates");
      addToast("Automatic security updates enabled", "success");
      await load(true);
    } catch (err) {
      addToast(
        err instanceof Error
          ? err.message
          : "Unable to enable automatic updates",
        "error",
      );
    } finally {
      setFixing(false);
    }
  };

  return (
    <div style={{ padding: "22px 24px", width: "100%", maxWidth: 1400 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div style={{ flex: 1 }}>
          <h1
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: T.text,
              letterSpacing: "-0.02em",
            }}
          >
            Security
          </h1>
          <p style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
            Firewall, SSH, authentication, and security events from the host.
          </p>
        </div>
        <Btn
          size="sm"
          variant="secondary"
          onClick={() => void load(true)}
          disabled={loading || refreshing}
        >
          <RefreshCw
            size={12}
            style={{
              animation: refreshing ? "spin 1s linear infinite" : undefined,
            }}
          />
          Refresh
        </Btn>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 8,
            border: `1px solid ${T.red}35`,
            background: `${T.red}0c`,
            color: T.red,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {loading && !data ? (
        <div style={{ color: T.textDim, fontSize: 12, padding: 24 }}>
          Reading host security configuration…
        </div>
      ) : data ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                padding: "12px 14px",
                background: T.raised,
                border: `1px solid ${T.border}`,
                borderRadius: 9,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  color: T.textDim,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: ".07em",
                }}
              >
                <Shield size={12} /> Posture
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 18,
                  fontWeight: 700,
                  color: failedChecks ? T.yellow : T.green,
                }}
              >
                {failedChecks
                  ? `${failedChecks} check${failedChecks > 1 ? "s" : ""} need attention`
                  : "All checks passing"}
              </div>
              <div style={{ marginTop: 3, fontSize: 10, color: T.textDim }}>
                {healthyChecks}/
                {data.checks.filter((c) => c.ok !== null).length} automated
                checks passing
              </div>
            </div>
            <div
              style={{
                padding: "12px 14px",
                background: T.raised,
                border: `1px solid ${T.border}`,
                borderRadius: 9,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  color: T.textDim,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: ".07em",
                }}
              >
                <Wifi size={12} /> Firewall
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 18,
                  fontWeight: 700,
                  color: data.firewallActive ? T.green : T.red,
                }}
              >
                {data.firewallActive ? "Active" : "Inactive"}
              </div>
              <div style={{ marginTop: 3, fontSize: 10, color: T.textDim }}>
                {data.firewallRules.length} configured rules
              </div>
            </div>
            <div
              style={{
                padding: "12px 14px",
                background: T.raised,
                border: `1px solid ${T.border}`,
                borderRadius: 9,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  color: T.textDim,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: ".07em",
                }}
              >
                <Lock size={12} /> SSH sessions
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 18,
                  fontWeight: 700,
                  color: T.text,
                }}
              >
                {data.sessions.length}
              </div>
              <div style={{ marginTop: 3, fontSize: 10, color: T.textDim }}>
                Currently logged-in users
              </div>
            </div>
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <Card>
              <CardHeader title="Security posture" sub="Live host checks" />
              {data.checks.map((c) => (
                <div
                  key={c.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 16px",
                    borderBottom: `1px solid ${T.borderMuted}`,
                  }}
                >
                  {c.ok === true && <CheckCircle2 size={15} color={T.green} />}
                  {c.ok === false && <XCircle size={15} color={T.red} />}
                  {c.ok === null && <Info size={15} color={T.yellow} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ fontSize: 12, fontWeight: 500, color: T.text }}
                    >
                      {c.label}
                    </div>
                    <div
                      style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}
                    >
                      {c.detail}
                    </div>
                  </div>
                  {c.label === "Auto security updates" && c.ok === false && (
                    <Btn
                      size="xs"
                      variant="danger"
                      onClick={() => void fixUpdates()}
                      disabled={fixing}
                    >
                      {fixing ? "Fixing…" : "Fix"}
                    </Btn>
                  )}
                </div>
              ))}
            </Card>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Card>
                <CardHeader
                  title="Active SSH sessions"
                  action={
                    data.sessions.length > 0 ? (
                      <span style={{ fontSize: 10, color: T.textDim }}>
                        {data.sessions.length} active
                      </span>
                    ) : undefined
                  }
                />
                {data.sessions.length === 0 ? (
                  <div
                    style={{
                      padding: "18px 16px",
                      fontSize: 12,
                      color: T.textDim,
                    }}
                  >
                    No active login sessions detected.
                  </div>
                ) : (
                  data.sessions.map((s) => (
                    <div
                      key={s.pid}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 16px",
                        borderBottom: `1px solid ${T.borderMuted}`,
                      }}
                    >
                      <Lock size={13} color={T.green} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: T.text,
                            fontFamily: "JetBrains Mono,monospace",
                          }}
                        >
                          {s.user}@{s.from}
                        </div>
                        <div style={{ fontSize: 11, color: T.textDim }}>
                          Since {s.since} · {s.method} · PID {s.pid}
                        </div>
                      </div>
                      <Btn
                        size="xs"
                        variant="ghost"
                        onClick={() => void killSession(s.pid)}
                        disabled={busyPid === s.pid}
                      >
                        {busyPid === s.pid ? "Killing…" : "Kill"}
                      </Btn>
                    </div>
                  ))
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Firewall — ufw"
                  action={
                    <Btn
                      size="xs"
                      variant="secondary"
                      onClick={() => setShowRules((v) => !v)}
                    >
                      {showRules ? "Hide rules" : "View rules"}
                    </Btn>
                  }
                />
                <div
                  style={{
                    padding: "10px 16px",
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 12px",
                      background: `${data.firewallActive ? T.green : T.red}12`,
                      border: `1px solid ${data.firewallActive ? T.green : T.red}28`,
                      borderRadius: 7,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: data.firewallActive ? T.green : T.red,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: data.firewallActive ? T.green : T.red,
                      }}
                    >
                      {data.firewallActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: T.textDim }}>
                    Rules read directly from UFW
                  </span>
                </div>
                {showRules && (
                  <div style={{ padding: "0 16px 12px" }}>
                    {data.firewallRules.length === 0 ? (
                      <div
                        style={{
                          fontSize: 11,
                          color: T.textDim,
                          padding: "8px 0",
                        }}
                      >
                        No parsed UFW rules.
                      </div>
                    ) : (
                      data.firewallRules.map((r, i) => (
                        <div
                          key={`${r.number}-${i}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "32px 90px 58px 1fr",
                            gap: 8,
                            padding: "6px 0",
                            borderBottom: `1px solid ${T.borderMuted}`,
                            fontSize: 11,
                            fontFamily: "JetBrains Mono,monospace",
                          }}
                        >
                          <span style={{ color: T.textDim }}>
                            {r.number || "—"}
                          </span>
                          <span style={{ color: T.textSub }}>{r.to}</span>
                          <span
                            style={{
                              color: r.action.includes("ALLOW")
                                ? T.green
                                : T.red,
                              fontWeight: 600,
                            }}
                          >
                            {r.action}
                          </span>
                          <span
                            style={{
                              color: T.textDim,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {r.from}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </Card>
            </div>

            <Card style={{ gridColumn: "1 / -1" }}>
              <CardHeader
                title="Security events"
                sub="Last 24 hours · system journal"
                action={
                  <span style={{ fontSize: 10, color: T.textDim }}>
                    <Clock
                      size={10}
                      style={{ verticalAlign: "-1px", marginRight: 4 }}
                    />
                    Updated {formatEventTime(data.updatedAt)}
                  </span>
                }
              />
              {data.events.length === 0 ? (
                <div
                  style={{
                    padding: "18px 16px",
                    fontSize: 12,
                    color: T.textDim,
                  }}
                >
                  No SSH, UFW, or fail2ban events were found in the last 24
                  hours.
                </div>
              ) : (
                data.events.map((e, i) => (
                  <div
                    key={`${e.timestamp}-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: "9px 16px",
                      borderBottom:
                        i < data.events.length - 1
                          ? `1px solid ${T.borderMuted}`
                          : "none",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: T.textDim,
                        fontFamily: "JetBrains Mono,monospace",
                        flexShrink: 0,
                        marginTop: 1,
                        width: 64,
                      }}
                    >
                      {formatEventTime(e.timestamp)}
                    </span>
                    {e.type === "error" && (
                      <AlertTriangle
                        size={13}
                        color={T.red}
                        style={{ flexShrink: 0, marginTop: 1 }}
                      />
                    )}
                    {e.type === "warn" && (
                      <AlertTriangle
                        size={13}
                        color={T.yellow}
                        style={{ flexShrink: 0, marginTop: 1 }}
                      />
                    )}
                    {e.type === "success" && (
                      <CheckCircle2
                        size={13}
                        color={T.green}
                        style={{ flexShrink: 0, marginTop: 1 }}
                      />
                    )}
                    {e.type === "info" && (
                      <Info
                        size={13}
                        color={T.accent}
                        style={{ flexShrink: 0, marginTop: 1 }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: 11,
                        color: T.textSub,
                        fontFamily: "JetBrains Mono,monospace",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {e.message}
                    </span>
                  </div>
                ))
              )}
            </Card>
          </div>
        </>
      ) : null}

      <div
        style={{
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: T.textDim,
          fontSize: 10,
        }}
      >
        <TerminalSquare size={11} /> Security data is read from UFW, OpenSSH,
        systemd, fail2ban, who, ss, and the system journal.
      </div>
    </div>
  );
}
