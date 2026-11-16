import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  RefreshCw,
  Shield,
  Check,
  Package,
  AlertTriangle,
  TerminalSquare,
} from "lucide-react";
import { T } from "../lib/tokens";
import { getSession } from "../lib/auth";
import {
  applyUpdates,
  getUpdates,
  refreshUpdates,
  getUpdateJob,
} from "../lib/api";
import type {
  ConfirmDialog,
  UpdateJob,
  UpdatePackage,
  UpdatesOverview,
} from "../lib/types";
import { Card, CardHeader, Btn, Th, Td } from "../components/ui";

function formatUpdatedAt(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString();
}
function UpdateTable({
  items,
  selected,
  toggle,
  allToggle,
  disabled,
}: {
  items: UpdatePackage[];
  selected: Set<string>;
  toggle: (pkg: string) => void;
  allToggle: () => void;
  disabled: boolean;
}) {
  const all = items.length > 0 && items.every((u) => selected.has(u.package));
  return (
    <Card>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: T.bg }}>
            <th
              style={{
                width: 40,
                padding: "8px 14px",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <input
                type="checkbox"
                disabled={disabled}
                checked={all}
                onChange={allToggle}
                style={{ accentColor: T.accent, cursor: "pointer" }}
              />
            </th>
            <Th>Package</Th>
            <Th mono>Current</Th>
            <Th mono>Available</Th>
            <Th>Type</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr
              key={u.package}
              onMouseEnter={(e) => (e.currentTarget.style.background = T.hover)}
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <td
                style={{
                  padding: "9px 14px",
                  borderBottom: `1px solid ${T.borderMuted}`,
                }}
              >
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selected.has(u.package)}
                  onChange={() => toggle(u.package)}
                  style={{ accentColor: T.accent, cursor: "pointer" }}
                />
              </td>
              <Td>
                <span
                  style={{
                    fontWeight: 600,
                    color: T.text,
                    fontFamily: "JetBrains Mono,monospace",
                    fontSize: 12,
                  }}
                >
                  {u.package}
                </span>
              </Td>
              <Td mono dim>
                {u.current}
              </Td>
              <Td mono>
                <span style={{ color: T.green }}>{u.available}</span>
              </Td>
              <Td>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    borderRadius: 3,
                    background: `${u.type === "security" ? T.red : T.yellow}18`,
                    color: u.type === "security" ? T.red : T.yellow,
                    fontWeight: 600,
                  }}
                >
                  {u.type === "security" ? "Security" : "System"}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default function UpdatesView({
  addToast,
  onConfirm,
}: {
  addToast: (m: string, t: any) => void;
  onConfirm: (d: ConfirmDialog) => void;
}) {
  const admin = getSession()?.user.role === "admin";
  const starting = useRef(false);
  const jobRevision = useRef(0);
  const [job, setJob] = useState<UpdateJob | null>(null);
  const [data, setData] = useState<UpdatesOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await getUpdates());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load updates");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const security = useMemo(
    () => data?.updates.filter((u) => u.type === "security") ?? [],
    [data],
  );
  const system = useMemo(
    () => data?.updates.filter((u) => u.type === "system") ?? [],
    [data],
  );
  const total = data?.updates.length ?? 0;
  const toggle = (pkg: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(pkg) ? next.delete(pkg) : next.add(pkg);
      return next;
    });
  const toggleItems = (items: UpdatePackage[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const all = items.length > 0 && items.every((u) => next.has(u.package));
      items.forEach((u) =>
        all ? next.delete(u.package) : next.add(u.package),
      );
      return next;
    });

  const startOperation = async (action: "refresh" | "apply", all = false) => {
    if (starting.current || job?.status === "running" || !admin) return;
    starting.current = true;
    jobRevision.current++;
    setError("");
    setOutput("");
    if (action === "refresh") setRefreshing(true);
    else setApplying(true);
    try {
      const task =
        action === "refresh"
          ? await refreshUpdates()
          : await applyUpdates(all ? [] : Array.from(selected), all);
      if (!task?.id || task.status !== "running")
        throw new Error(
          "API does not support tracked updates. Rebuild/restart CoreOps before retrying.",
        );
      setJob(task);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to start package operation",
      );
      setApplying(false);
      setRefreshing(false);
    } finally {
      starting.current = false;
    }
  };
  const checkNow = () => startOperation("refresh");
  const performApply = (all: boolean) => startOperation("apply", all);
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    const revision = jobRevision.current;
    void getUpdateJob("current", controller.signal)
      .then((task) => {
        if (!controller.signal.aborted && revision === jobRevision.current) {
          setJob(task);
          if (task) {
            setOutput(task.output || "");
            if (task.error) setError(task.error);
          }
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(`Update job status unavailable: ${e.message}`);
      });
    return () => controller.abort();
  }, [admin]);
  useEffect(() => {
    if (!job || job.status !== "running") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const task = await getUpdateJob(job.id, controller.signal);
        if (controller.signal.aborted) return;
        if (!task)
          throw new Error(
            "Job status unavailable; check APT/dpkg before retrying.",
          );
        setJob(task);
        setOutput(task.output || "");
        if (task.status === "running") {
          timer = setTimeout(() => void poll(), 1000);
          return;
        }
        setRefreshing(false);
        setApplying(false);
        if (task.status === "failed") {
          setError(task.error || "Package operation failed");
          addToast("Package operation failed; inspect the result", "error");
        } else {
          setSelected(new Set());
          if (task.overview) setData(task.overview);
          else void load();
          if (task.warning) setError(task.warning);
          addToast(
            task.action === "refresh"
              ? "Package index refreshed"
              : "Package operation completed",
            "success",
          );
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(
            `Status unavailable: ${e instanceof Error ? e.message : "connection lost"}. The operation may still be running; status will be checked again automatically.`,
          );
          timer = setTimeout(() => void poll(), 5000);
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [job?.id, job?.status]);
  const busy = refreshing || applying || job?.status === "running";
  const allowed = admin && data?.capability?.available !== false;
  const confirmApply = (all: boolean) =>
    onConfirm({
      title: all
        ? "Apply all available updates?"
        : `Apply ${selected.size} selected update${selected.size === 1 ? "" : "s"}?`,
      message: all
        ? "All available packages will be upgraded. Some services may restart automatically. This operation may take several minutes."
        : "The selected packages will be upgraded. Some services may restart automatically.",
      action: all ? "Apply all updates" : "Apply selected",
      danger: true,
      requireConfirmation: true,
      onConfirm: () => void performApply(all),
    });

  return (
    <div style={{ padding: "22px 24px", maxWidth: 1400, width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 18,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: T.text,
              letterSpacing: "-0.02em",
            }}
          >
            Updates
          </h1>
          <p style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
            System package updates for the current server.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn
            onClick={() => void checkNow()}
            disabled={!allowed || busy}
            variant="secondary"
            icon={
              <RefreshCw
                size={11}
                style={
                  refreshing
                    ? { animation: "spin 1s linear infinite" }
                    : undefined
                }
              />
            }
          >
            {refreshing ? "Refreshing…" : "Check now"}
          </Btn>
          {selected.size > 0 && (
            <Btn
              onClick={() => confirmApply(false)}
              variant="primary"
              disabled={!allowed || busy}
            >
              {applying ? "Applying…" : `Apply ${selected.size} selected`}
            </Btn>
          )}
          <Btn
            onClick={() => confirmApply(true)}
            disabled={!allowed || busy || !data || total === 0}
            variant="primary"
            icon={<Check size={11} />}
          >
            {applying ? "Applying…" : "Apply all"}
          </Btn>
        </div>
      </div>

      {!admin && (
        <p style={{ color: T.textDim, marginBottom: 12 }}>
          Admin role required to change packages.
        </p>
      )}
      {data?.capability?.available === false && (
        <p role="alert" style={{ color: T.yellow, marginBottom: 12 }}>
          {data.capability.error}
        </p>
      )}
      {job && (
        <section
          aria-label="Package operation"
          data-surface="panel"
          style={{
            padding: 12,
            marginBottom: 14,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            color: T.textSub,
          }}
        >
          <strong>
            {job.action} · {job.status}
          </strong>
          <p>
            Job {job.id} · Started {new Date(job.startedAt).toLocaleString()}
            {job.finishedAt
              ? ` · Finished ${new Date(job.finishedAt).toLocaleString()}`
              : " · Continues if you navigate away"}
          </p>
          {job.status === "running" && (
            <span role="status">
              Package operation running. Progress is confirmed by APT; do not
              start another operation.
            </span>
          )}
        </section>
      )}
      {error && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 9,
            padding: "10px 12px",
            marginBottom: 14,
            border: `1px solid ${T.red}35`,
            background: `${T.red}0d`,
            borderRadius: 8,
            color: T.red,
            fontSize: 11,
          }}
        >
          <AlertTriangle size={13} />
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={() => void load()}
            style={{
              background: "none",
              border: 0,
              color: T.red,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div
        style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}
      >
        {[
          {
            label: "Security",
            value: data?.securityCount ?? 0,
            color: T.red,
            icon: <Shield size={13} />,
          },
          {
            label: "System",
            value: data?.systemCount ?? 0,
            color: T.yellow,
            icon: <Package size={13} />,
          },
          {
            label: "Total",
            value: total,
            color: T.text,
            icon: <Check size={13} />,
          },
        ].map((s) => (
          <div
            data-surface="panel"
            key={s.label}
            style={{
              padding: "10px 14px",
              background: T.raised,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ color: s.color, display: "flex" }}>{s.icon}</span>
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: s.color,
                fontFamily: "JetBrains Mono,monospace",
                lineHeight: 1,
              }}
            >
              {s.value}
            </span>
            <span
              style={{
                fontSize: 11,
                color: T.textDim,
                textTransform: "uppercase",
                letterSpacing: ".05em",
              }}
            >
              {s.label}
            </span>
          </div>
        ))}
        <div
          style={{
            marginLeft: "auto",
            alignSelf: "center",
            fontSize: 10,
            color: T.textDim,
            fontFamily: "JetBrains Mono,monospace",
          }}
        >
          Local index read {formatUpdatedAt(data?.updatedAt ?? "")}
        </div>
      </div>

      {loading ? (
        <Card>
          <div
            style={{
              padding: 28,
              textAlign: "center",
              fontSize: 12,
              color: T.textDim,
            }}
          >
            Reading package index…
          </div>
        </Card>
      ) : !data ? (
        <p>
          Package status unavailable. Retry after checking the connection and
          permissions.
        </p>
      ) : total === 0 ? (
        <Card>
          <div style={{ padding: "42px 20px", textAlign: "center" }}>
            <Check size={24} color={T.green} />
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: T.text,
                marginTop: 10,
              }}
            >
              System is up to date
            </div>
            <div style={{ fontSize: 11, color: T.textDim, marginTop: 4 }}>
              No packages are currently marked as upgradable.
            </div>
          </div>
        </Card>
      ) : (
        <>
          {security.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                <Shield size={13} color={T.red} />
                <span style={{ fontSize: 12, fontWeight: 700, color: T.red }}>
                  Security updates
                </span>
              </div>
              <UpdateTable
                items={security}
                selected={selected}
                toggle={toggle}
                disabled={!admin || busy}
                allToggle={() => toggleItems(security)}
              />
            </div>
          )}
          {system.length > 0 && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                <RefreshCw size={13} color={T.yellow} />
                <span
                  style={{ fontSize: 12, fontWeight: 700, color: T.yellow }}
                >
                  System updates
                </span>
              </div>
              <UpdateTable
                items={system}
                selected={selected}
                toggle={toggle}
                disabled={!admin || busy}
                allToggle={() => toggleItems(system)}
              />
            </div>
          )}
        </>
      )}

      {output && (
        <div style={{ marginTop: 14 }}>
          <Card>
            <CardHeader
              title="Last update operation"
              action={
                <button
                  onClick={() => setOutput("")}
                  style={{
                    background: "none",
                    border: 0,
                    color: T.textDim,
                    cursor: "pointer",
                    fontSize: 10,
                  }}
                >
                  Clear
                </button>
              }
            />
            <pre
              style={{
                margin: 0,
                padding: "12px 14px",
                maxHeight: 240,
                overflow: "auto",
                fontSize: 10,
                lineHeight: 1.5,
                color: T.textSub,
                fontFamily: "JetBrains Mono,monospace",
                whiteSpace: "pre-wrap",
              }}
            >
              <TerminalSquare
                size={11}
                style={{ verticalAlign: "-2px", marginRight: 6 }}
              />
              {output}
            </pre>
          </Card>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
