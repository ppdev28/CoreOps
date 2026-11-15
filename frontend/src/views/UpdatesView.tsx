import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Shield,
  Check,
  Package,
  AlertTriangle,
  TerminalSquare,
} from "lucide-react";
import { T } from "../lib/tokens";
import { applyUpdates, getUpdates, refreshUpdates } from "../lib/api";
import type {
  ConfirmDialog,
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
}: {
  items: UpdatePackage[];
  selected: Set<string>;
  toggle: (pkg: string) => void;
  allToggle: () => void;
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

  const checkNow = async () => {
    setRefreshing(true);
    setError("");
    try {
      const fresh = await refreshUpdates();
      setData(fresh);
      setSelected(new Set());
      addToast(
        `${fresh.updates.length} update${fresh.updates.length === 1 ? "" : "s"} available`,
        "info",
      );
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Unable to refresh package index";
      setError(message);
      addToast(message, "error");
    } finally {
      setRefreshing(false);
    }
  };
  const performApply = async (all: boolean) => {
    setApplying(true);
    setError("");
    try {
      const result = await applyUpdates(all ? [] : Array.from(selected), all);
      setOutput(result.output);
      setSelected(new Set());
      const fresh = await getUpdates();
      setData(fresh);
      addToast(
        all
          ? "All updates applied successfully"
          : "Selected updates applied successfully",
        "success",
      );
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Unable to apply updates";
      setError(message);
      addToast(message, "error");
    } finally {
      setApplying(false);
    }
  };
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
            <Btn onClick={() => confirmApply(false)} variant="primary">
              {applying ? "Applying…" : `Apply ${selected.size} selected`}
            </Btn>
          )}
          <Btn
            onClick={() => confirmApply(true)}
            variant="primary"
            icon={<Check size={11} />}
          >
            {applying ? "Applying…" : "Apply all"}
          </Btn>
        </div>
      </div>

      {error && (
        <div
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
          Last checked {formatUpdatedAt(data?.updatedAt ?? "")}
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
