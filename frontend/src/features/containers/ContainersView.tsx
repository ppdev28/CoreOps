import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import {
  Box,
  Plus,
  MoreHorizontal,
  Play,
  Square,
  RotateCw,
  Pause,
  FileText,
  Terminal,
  Trash2,
  Search,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { T } from "../../lib/tokens";
import { getSession } from "../../shared/platform/session";
import CreateContainerDialog from "../../components/CreateContainerDialog";
import {
  getContainers,
  deleteContainer,
  runContainerAction,
  type ContainerAction,
} from "./api";
import type { Container } from "./model";
import type { ConfirmDialog } from "../../lib/types";
import {
  Card,
  StatusBadge,
  HealthBadge,
  Btn,
  Th,
  Td,
  EmptyState,
  FilterToggle,
  Input,
} from "../../components/ui";

type PendingContainerAction = ContainerAction | "delete";
const actionProgress: Record<PendingContainerAction, string> = {
  start: "Starting…",
  stop: "Stopping…",
  restart: "Restarting…",
  delete: "Deleting…",
};

function CtxMenu({
  x,
  y,
  c,
  onClose,
  onAction,
  canDelete,
  busy,
}: {
  x: number;
  y: number;
  c: Container;
  onClose: () => void;
  onAction: (a: string, c: Container) => void;
  canDelete: boolean;
  busy: boolean;
}) {
  const items = [
    {
      label: "Start",
      icon: <Play size={12} />,
      action: "start",
      show: c.status !== "running",
      danger: false,
    },
    {
      label: "Stop",
      icon: <Square size={12} />,
      action: "stop",
      show: c.status === "running",
      danger: false,
    },
    {
      label: "Restart",
      icon: <RotateCw size={12} />,
      action: "restart",
      show: true,
      danger: false,
    },
    {
      label: "Pause",
      icon: <Pause size={12} />,
      action: "pause",
      show: c.status === "running",
      danger: false,
    },
    null,
    {
      label: "Logs",
      icon: <FileText size={12} />,
      action: "logs",
      show: true,
      danger: false,
    },
    {
      label: "Terminal",
      icon: <Terminal size={12} />,
      action: "terminal",
      show: true,
      danger: false,
    },
    {
      label: "Inspect",
      icon: <Box size={12} />,
      action: "inspect",
      show: true,
      danger: false,
    },
    null,
    {
      label: "Delete",
      icon: <Trash2 size={12} />,
      action: "delete",
      show: canDelete,
      danger: true,
    },
  ];
  const menuHeight = Math.min(380, window.innerHeight - 16);
  const top = Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8));
  const left = Math.max(8, Math.min(x, window.innerWidth - 180));
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 998 }}
        onClick={onClose}
      />
      <div
        data-surface="nested"
        className="anim-slide-down"
        style={{
          position: "fixed",
          top,
          left,
          zIndex: 999,
          width: 172,
          maxHeight: menuHeight,
          overflowY: "auto",
          background: T.overlay,
          border: `1px solid ${T.borderStrong}`,
          borderRadius: 9,
          padding: "4px 0",
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            padding: "7px 12px 4px",
            fontSize: 11,
            fontWeight: 600,
            color: T.textDim,
            letterSpacing: "0.04em",
          }}
        >
          {c.name}
        </div>
        <div style={{ height: 1, background: T.border, margin: "2px 0 4px" }} />
        {items.map((item, i) =>
          item === null ? (
            <div
              key={i}
              style={{ height: 1, background: T.border, margin: "4px 0" }}
            />
          ) : (
            item.show && (
              <button
                key={item.label}
                disabled={busy}
                onClick={() => {
                  onAction(item.action, c);
                  onClose();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  width: "100%",
                  padding: "6px 12px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: item.danger ? T.red : T.textSub,
                  fontSize: 12,
                  textAlign: "left",
                  fontFamily: "Inter,sans-serif",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = T.hover)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "none")
                }
              >
                <span style={{ color: item.danger ? T.red : T.textDim }}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            )
          ),
        )}
      </div>
    </>
  );
}

function MobileContainerCard({
  c,
  selected,
  pendingAction,
  onSelect,
  onOpen,
  onMenu,
}: {
  c: Container;
  selected: boolean;
  pendingAction?: PendingContainerAction;
  onSelect: () => void;
  onOpen: () => void;
  onMenu: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      className="containers-mobile-card"
      onClick={() => {
        if (!pendingAction) onOpen();
      }}
      style={{
        opacity: pendingAction ? 0.6 : 1,
        cursor: pendingAction ? "wait" : "pointer",
      }}
    >
      <div className="containers-mobile-card-head">
        <div className="containers-mobile-card-title">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ accentColor: T.accent, cursor: "pointer" }}
            aria-label={`Select ${c.name}`}
          />
          <div className="containers-mobile-card-name-wrap">
            <div className="containers-mobile-card-name">{c.name}</div>
            <div className="containers-mobile-card-image">{c.image}</div>
          </div>
        </div>
        <div className="containers-mobile-card-actions">
          <StatusBadge status={c.status} />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMenu(e);
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: T.textDim,
              padding: 6,
              borderRadius: 6,
              display: "inline-flex",
            }}
            disabled={!!pendingAction}
            aria-label={`Actions for ${c.name}`}
          >
            <MoreHorizontal size={18} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <div className="containers-mobile-card-health">
        <HealthBadge health={c.health} />
        {pendingAction && (
          <span className="containers-mobile-card-pending">
            {actionProgress[pendingAction]}
          </span>
        )}
      </div>

      <div className="containers-mobile-metrics">
        {[
          { label: "CPU", value: c.cpu },
          { label: "Memory", value: c.memory },
          { label: "Network", value: c.net },
          { label: "Uptime", value: c.uptime },
          { label: "Ports", value: c.ports },
          {
            label: "Restarts",
            value: c.restarts == null ? "—" : String(c.restarts),
          },
        ].map((item) => (
          <div key={item.label} className="containers-mobile-metric">
            <span>{item.label}</span>
            <strong
              className={
                item.label === "Restarts" && (c.restarts ?? 0) > 2
                  ? "warning"
                  : ""
              }
            >
              {item.value}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ContainersView({
  onLogs,
  onDetail,
  addToast,
  onConfirm,
}: {
  onDetail: (id: string) => void;
  onLogs: (id: string) => void;
  addToast: (m: string, t: any) => void;
  onConfirm: (d: ConfirmDialog) => void;
}) {
  const [creating, setCreating] = useState(false);
  const canCreate = getSession()?.user.role === "admin";
  const canDelete = canCreate;
  const actionLocks = useRef(new Set<string>());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "stopped">("all");
  const [ctx, setCtx] = useState<{ x: number; y: number; c: Container } | null>(
    null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingActions, setPendingActions] = useState<
    Map<string, PendingContainerAction>
  >(new Map());

  const loadContainers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setContainers(await getContainers());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to connect to CoreOps API",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContainers();
  }, [loadContainers]);

  const refreshAfterAction = async () => {
    try {
      setContainers(await getContainers());
    } catch (err) {
      addToast(
        `Action completed, but the container list could not refresh: ${err instanceof Error ? err.message : "unknown error"}`,
        "error",
      );
    }
  };

  const rows = containers.filter((c) => {
    const q = search.toLowerCase();
    return (
      (c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q)) &&
      (filter === "all" || c.status === filter)
    );
  });
  const running = containers.filter((c) => c.status === "running").length;
  const stopped = containers.filter((c) => c.status === "stopped").length;
  const restarting = containers.filter((c) => c.status === "restarting").length;

  const executeContainerAction = async (
    action: ContainerAction,
    c: Container,
  ) => {
    if (actionLocks.current.has(c.id)) return;
    actionLocks.current.add(c.id);
    setPendingActions((previous) => new Map(previous).set(c.id, action));
    try {
      await runContainerAction(c.id, action);
      await refreshAfterAction();
      const pastTense: Record<ContainerAction, string> = {
        start: "started",
        stop: "stopped",
        restart: "restarted",
      };
      addToast(`${c.name} ${pastTense[action]}`, "success");
    } catch (err) {
      addToast(
        `Unable to ${action} ${c.name}: ${err instanceof Error ? err.message : "unknown error"}`,
        "error",
      );
    } finally {
      actionLocks.current.delete(c.id);
      setPendingActions((previous) => {
        const next = new Map(previous);
        next.delete(c.id);
        return next;
      });
    }
  };

  const executeSelectedStops = async () => {
    const targets = containers.filter(
      (c) =>
        selected.has(c.id) &&
        c.status === "running" &&
        !actionLocks.current.has(c.id),
    );
    if (targets.length === 0) return;
    targets.forEach((c) => actionLocks.current.add(c.id));
    setPendingActions((previous) => {
      const next = new Map(previous);
      targets.forEach((c) => next.set(c.id, "stop"));
      return next;
    });
    try {
      const results = await Promise.allSettled(
        targets.map((c) => runContainerAction(c.id, "stop")),
      );
      await refreshAfterAction();
      const failed = results.filter(
        (result) => result.status === "rejected",
      ).length;
      addToast(
        failed === 0
          ? `Stopped ${targets.length} containers`
          : `Stopped ${targets.length - failed} of ${targets.length} containers`,
        failed === 0 ? "success" : "error",
      );
    } finally {
      targets.forEach((c) => actionLocks.current.delete(c.id));
      setPendingActions((previous) => {
        const next = new Map(previous);
        targets.forEach((c) => next.delete(c.id));
        return next;
      });
      setSelected(new Set());
    }
  };

  const executeDelete = async (c: Container) => {
    if (!canDelete || actionLocks.current.has(c.id)) return;
    actionLocks.current.add(c.id);
    setPendingActions((previous) => new Map(previous).set(c.id, "delete"));
    setDeleteError(null);
    try {
      await deleteContainer(c.id);
      setContainers((previous) => previous.filter((item) => item.id !== c.id));
      setSelected((previous) => {
        const next = new Set(previous);
        next.delete(c.id);
        return next;
      });
      await refreshAfterAction();
      addToast(`Deleted ${c.name}`, "success");
    } catch (cause) {
      setDeleteError(
        `Unable to delete ${c.name}: ${cause instanceof Error ? cause.message : "unknown error"}`,
      );
    } finally {
      actionLocks.current.delete(c.id);
      setPendingActions((previous) => {
        const next = new Map(previous);
        next.delete(c.id);
        return next;
      });
    }
  };

  const handleAction = (action: string, c: Container) => {
    if (actionLocks.current.has(c.id)) return;
    if (action === "logs") {
      onLogs(c.id);
      return;
    }
    if (action === "start") {
      void executeContainerAction("start", c);
      return;
    }
    if (action === "stop") {
      onConfirm({
        title: `Stop "${c.name}"?`,
        message:
          "The container will be stopped. You can restart it at any time.",
        action: "Stop container",
        danger: true,
        onConfirm: () => void executeContainerAction("stop", c),
      });
      return;
    }
    if (action === "restart") {
      onConfirm({
        title: `Restart "${c.name}"?`,
        message:
          "The container will be briefly unavailable while Docker restarts it.",
        action: "Restart container",
        onConfirm: () => void executeContainerAction("restart", c),
      });
      return;
    }
    if (action === "delete") {
      if (!canDelete) return;
      if (c.status !== "stopped") {
        setDeleteError(
          `Stop ${c.name} and refresh its state before deleting it.`,
        );
        return;
      }
      onConfirm({
        title: `Delete container "${c.name}"?`,
        message:
          "This will permanently remove the stopped container and its writable layer. Volumes and images will not be deleted.",
        action: "Delete container",
        danger: true,
        requireConfirmation: true,
        onConfirm: () => void executeDelete(c),
      });
    } else {
      const msgs: Record<string, string> = {
        start: `Starting ${c.name}…`,
        restart: `Restarting ${c.name}…`,
        pause: `Pausing ${c.name}…`,
        logs: `Opening logs for ${c.name}`,
        terminal: `Connecting to ${c.name}…`,
        inspect: `Inspecting ${c.name}`,
      };
      addToast(msgs[action] || action, "info");
    }
  };

  const toggleAll = () => {
    if (rows.every((c) => selected.has(c.id))) setSelected(new Set());
    else setSelected(new Set(rows.map((c) => c.id)));
  };

  return (
    <div className="containers-view" style={{ padding: "22px 24px" }}>
      {creating && canCreate && (
        <CreateContainerDialog
          images={Array.from(
            new Set(containers.map((container) => container.image)),
          )}
          onClose={() => setCreating(false)}
          onCreated={async (created) => {
            setSearch("");
            setFilter("all");
            await refreshAfterAction();
            addToast(
              `${created.name} created${created.started ? "; start requested" : ""}`,
              created.startError ? "info" : "success",
            );
          }}
          onComposeCreated={async (created) => {
            setSearch("");
            setFilter("all");
            await refreshAfterAction();
            addToast(
              `${created.project}: ${created.state === "partial" ? "inspect partial Compose result" : created.state === "started" ? "Compose start requested" : "Compose project created"}`,
              created.state === "partial" ? "info" : "success",
            );
          }}
          onInspect={(id) => {
            setCreating(false);
            onDetail(id);
          }}
        />
      )}
      {ctx && (
        <CtxMenu
          x={ctx.x}
          y={ctx.y}
          c={ctx.c}
          onClose={() => setCtx(null)}
          onAction={handleAction}
          canDelete={canDelete}
          busy={actionLocks.current.has(ctx.c.id)}
        />
      )}
      <div className="containers-header" style={{ marginBottom: 18 }}>
        <h1
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: T.text,
            letterSpacing: "-0.02em",
          }}
        >
          Containers
        </h1>
        <p style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
          Manage and monitor Docker containers running on this server.
        </p>
      </div>

      {deleteError && (
        <div
          role="alert"
          style={{
            padding: 12,
            marginBottom: 14,
            border: `1px solid ${T.red}`,
            borderRadius: 12,
            color: T.red,
            fontSize: 12,
            overflowWrap: "anywhere",
          }}
        >
          {deleteError}
          <Btn
            variant="ghost"
            onClick={() => setDeleteError(null)}
            style={{ marginLeft: 10 }}
          >
            Dismiss
          </Btn>
        </div>
      )}

      <div
        className="containers-stats"
        style={{ display: "flex", gap: 10, marginBottom: 14 }}
      >
        {[
          { label: "Total", value: containers.length, color: T.text },
          { label: "Running", value: running, color: T.green },
          { label: "Stopped", value: stopped, color: T.textDim },
          { label: "Restarting", value: restarting, color: T.yellow },
        ].map((s) => (
          <div
            data-surface="panel"
            key={s.label}
            className="containers-stat-card"
            style={{
              padding: "8px 14px",
              background: T.raised,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              display: "flex",
              gap: 8,
              alignItems: "baseline",
            }}
          >
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
                letterSpacing: "0.05em",
              }}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>

      <div
        className="containers-toolbar"
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 14,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Input
          value={search}
          onChange={setSearch}
          placeholder="Search containers…"
          icon={<Search size={12} />}
          style={{ maxWidth: 260 }}
        />
        <FilterToggle
          options={[
            { label: "All", value: "all" },
            { label: "Running", value: "running" },
            { label: "Stopped", value: "stopped" },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div style={{ flex: 1 }} />
        <Btn
          icon={<RefreshCw size={11} />}
          onClick={() => void loadContainers()}
        >
          Refresh
        </Btn>
        {selected.size > 0 && (
          <Btn
            onClick={() =>
              onConfirm({
                title: `Stop ${selected.size} containers?`,
                message: "All selected running containers will be stopped.",
                action: "Stop all",
                danger: true,
                onConfirm: () => void executeSelectedStops(),
              })
            }
            variant="danger"
            icon={<Square size={11} />}
          >
            Stop {selected.size}
          </Btn>
        )}
        {canCreate && (
          <Btn
            icon={<Plus size={11} />}
            variant="primary"
            onClick={() => setCreating(true)}
          >
            Create container
          </Btn>
        )}
      </div>

      {loading ? (
        <Card>
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: T.textDim,
              fontSize: 12,
            }}
          >
            Loading containers…
          </div>
        </Card>
      ) : error ? (
        <Card>
          <div style={{ padding: 40, textAlign: "center" }}>
            <AlertTriangle size={24} color={T.yellow} />
            <div
              style={{
                marginTop: 10,
                color: T.text,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Unable to load containers
            </div>
            <div style={{ marginTop: 5, color: T.textDim, fontSize: 12 }}>
              {error}
            </div>
            <div style={{ marginTop: 14 }}>
              <Btn
                icon={<RefreshCw size={11} />}
                onClick={() => void loadContainers()}
              >
                Retry
              </Btn>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div className="containers-mobile-list">
            {rows.length > 0 ? (
              rows.map((c) => (
                <MobileContainerCard
                  key={c.id}
                  c={c}
                  selected={selected.has(c.id)}
                  pendingAction={pendingActions.get(c.id)}
                  onSelect={() =>
                    setSelected((prev) => {
                      const s = new Set(prev);
                      s.has(c.id) ? s.delete(c.id) : s.add(c.id);
                      return s;
                    })
                  }
                  onOpen={() => onDetail(c.id)}
                  onMenu={(e) => setCtx({ x: e.clientX, y: e.clientY, c })}
                />
              ))
            ) : (
              <Card>
                <EmptyState
                  icon={<Box size={28} />}
                  title="No containers found"
                  sub="Adjust your search or filter criteria."
                />
              </Card>
            )}
          </div>

          <div className="containers-desktop-table">
            <Card>
              <div className="containers-table-scroll">
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 760,
                  }}
                >
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
                          checked={
                            rows.length > 0 &&
                            rows.every((c) => selected.has(c.id))
                          }
                          onChange={toggleAll}
                          style={{ accentColor: T.accent, cursor: "pointer" }}
                        />
                      </th>
                      <Th>Name</Th>
                      <Th>Image</Th>
                      <Th>Status</Th>
                      <Th>Health</Th>
                      <Th mono>CPU</Th>
                      <Th mono>Memory</Th>
                      <Th mono>Ports</Th>
                      <Th>Uptime</Th>
                      <Th right>Restarts</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => {
                      const pendingAction = pendingActions.get(c.id);
                      return (
                        <tr
                          key={c.id}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setCtx({ x: e.clientX, y: e.clientY, c });
                          }}
                          onClick={() => {
                            if (!actionLocks.current.has(c.id)) onDetail(c.id);
                          }}
                          style={{
                            cursor: pendingAction ? "wait" : "pointer",
                            opacity: pendingAction ? 0.6 : 1,
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = T.hover)
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          <td
                            style={{
                              padding: "9px 14px",
                              borderBottom: `1px solid ${T.borderMuted}`,
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(c.id)}
                              onChange={() =>
                                setSelected((prev) => {
                                  const s = new Set(prev);
                                  s.has(c.id) ? s.delete(c.id) : s.add(c.id);
                                  return s;
                                })
                              }
                              style={{
                                accentColor: T.accent,
                                cursor: "pointer",
                              }}
                            />
                          </td>
                          <Td>
                            <span
                              style={{
                                fontWeight: 700,
                                color: T.text,
                                fontFamily: "JetBrains Mono,monospace",
                                fontSize: 12,
                              }}
                            >
                              {c.name}
                            </span>
                          </Td>
                          <Td mono dim>
                            {c.image}
                          </Td>
                          <Td>
                            <StatusBadge status={c.status} />
                          </Td>
                          <Td>
                            <HealthBadge health={c.health} />
                          </Td>
                          <Td mono dim>
                            {c.cpu}
                          </Td>
                          <Td mono dim>
                            {c.memory}
                          </Td>
                          <Td mono dim>
                            {c.ports}
                          </Td>
                          <Td dim>{c.uptime}</Td>
                          <Td right>
                            <span
                              style={{
                                fontSize: 11,
                                fontFamily: "JetBrains Mono,monospace",
                                color:
                                  (c.restarts ?? 0) > 2 ? T.yellow : T.textDim,
                              }}
                            >
                              {c.restarts ?? "—"}
                            </span>
                          </Td>
                          <Td style={{ textAlign: "right" }}>
                            {pendingAction ? (
                              <span style={{ fontSize: 11, color: T.accent }}>
                                {actionProgress[pendingAction]}
                              </span>
                            ) : (
                              <button
                                aria-label={`Actions for ${c.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCtx({ x: e.clientX, y: e.clientY, c });
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  color: T.textDim,
                                  padding: "2px 4px",
                                  borderRadius: 5,
                                  display: "inline-flex",
                                }}
                              >
                                <MoreHorizontal size={14} />
                              </button>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {rows.length === 0 && (
                <EmptyState
                  icon={<Box size={28} />}
                  title="No containers found"
                  sub="Adjust your search or filter criteria."
                />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
