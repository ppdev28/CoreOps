import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  MonitorCog,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { T } from "../lib/tokens";
import { getVirtualMachines, runVirtualMachineAction } from "../lib/api";
import type {
  ToastType,
  VirtualMachine,
  VirtualMachineAction,
} from "../lib/types";
import { Btn, Card } from "../components/ui";

function machineState(machine: VirtualMachine) {
  return typeof machine.state === "string" ? machine.state.trim() : "Unknown";
}

function isRunning(machine: VirtualMachine) {
  return machineState(machine).toLowerCase().includes("running");
}

function stateLabel(machine: VirtualMachine) {
  const state = machineState(machine);
  const normalized = state.toLowerCase();
  if (normalized.includes("running")) return "Running";
  if (normalized.includes("shut off")) return "Shut off";
  if (normalized.includes("paused")) return "Paused";
  return state;
}

function StateBadge({ machine }: { machine: VirtualMachine }) {
  const running = isRunning(machine);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 12,
        color: running ? T.green : T.textSub,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: running ? T.green : T.textDim,
          boxShadow: running ? `0 0 0 2px ${T.green}22` : "none",
        }}
      />
      {stateLabel(machine)}
    </span>
  );
}

function MachineRow({
  machine,
  busy,
  onAction,
}: {
  machine: VirtualMachine;
  busy: string | null;
  onAction: (machine: VirtualMachine, action: VirtualMachineAction) => void;
}) {
  const running = isRunning(machine);
  const actionBusy = busy === machine.name;

  return (
    <tr style={{ borderTop: `1px solid ${T.borderMuted}` }}>
      <td style={{ padding: "13px 16px" }}>
        <span style={{ color: T.accent, fontSize: 13, fontWeight: 600 }}>
          {machine.name}
        </span>
      </td>
      <td style={{ padding: "13px 16px", color: T.textSub, fontSize: 12 }}>
        {machine.connection || "System"}
      </td>
      <td style={{ padding: "13px 16px" }}>
        <StateBadge machine={machine} />
      </td>
      <td style={{ padding: "9px 16px", textAlign: "right", width: 150 }}>
        <Btn
          size="sm"
          variant="secondary"
          disabled={actionBusy}
          onClick={() => onAction(machine, running ? "shutdown" : "start")}
          icon={running ? <Square size={12} /> : <Play size={12} />}
          style={{ borderColor: T.accent, color: T.accent }}
        >
          {actionBusy ? "Working…" : running ? "Shutdown" : "Run"}
        </Btn>
      </td>
    </tr>
  );
}

export default function VirtualMachinesView({
  addToast,
}: {
  addToast: (message: string, type: ToastType) => void;
}) {
  const [machines, setMachines] = useState<VirtualMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(
    async (background = false) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await getVirtualMachines();
        setMachines(Array.isArray(result) ? result : []);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unable to load virtual machines";
        setError(message);
        if (background) addToast(message, "error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [addToast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return machines;
    return machines.filter((machine) =>
      machine.name.toLowerCase().includes(query),
    );
  }, [filter, machines]);

  const handleAction = useCallback(
    async (machine: VirtualMachine, action: VirtualMachineAction) => {
      setBusy(machine.name);
      try {
        await runVirtualMachineAction(machine.name, action);
        addToast(
          `${action === "start" ? "Starting" : "Shutting down"} ${machine.name}`,
          "success",
        );
        await load(true);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : `Unable to ${action} ${machine.name}`;
        addToast(message, "error");
      } finally {
        setBusy(null);
      }
    },
    [addToast, load],
  );

  const running = machines.filter(isRunning).length;
  const stopped = Math.max(0, machines.length - running);

  return (
    <div style={{ padding: "22px 24px", width: "100%", maxWidth: 1400 }}>
      <div
        style={{ display: "flex", alignItems: "flex-start", marginBottom: 18 }}
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
            Virtual machines
          </h1>
          <p style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
            QEMU / libvirt virtual machines available on the system connection.
          </p>
        </div>
        <Btn
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={12} />}
          disabled={loading || refreshing}
          onClick={() => void load(true)}
          style={{ marginLeft: "auto" }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </Btn>
      </div>

      <div
        data-layout="content"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <Card style={{ padding: "14px 16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <MonitorCog size={14} color={T.textDim} />
              <span style={{ fontSize: 12, color: T.accent }}>
                Virtual machines
              </span>
            </div>
            <span
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: T.text,
                fontFamily: "JetBrains Mono,monospace",
              }}
            >
              {machines.length}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: 16,
              marginTop: 7,
              fontSize: 10,
              color: T.textDim,
              fontFamily: "JetBrains Mono,monospace",
            }}
          >
            <span>
              <b style={{ color: T.green }}>{running}</b> running
            </span>
            <span>
              <b style={{ color: T.textSub }}>{stopped}</b> shut off
            </span>
          </div>
        </Card>
        <Card style={{ padding: "14px 16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <MonitorCog size={14} color={T.textDim} />
              <span style={{ fontSize: 12, color: T.accent }}>Connection</span>
            </div>
            <span
              style={{
                fontSize: 12,
                color: T.textSub,
                fontFamily: "JetBrains Mono,monospace",
              }}
            >
              System
            </span>
          </div>
          <div style={{ marginTop: 7, fontSize: 10, color: T.textDim }}>
            libvirt · qemu:///system
          </div>
        </Card>
      </div>

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            marginBottom: 14,
            border: `1px solid ${T.red}35`,
            background: `${T.red}0d`,
            borderRadius: 8,
          }}
        >
          <AlertTriangle size={13} color={T.red} />
          <span style={{ flex: 1, fontSize: 11, color: T.textSub }}>
            {error}
          </span>
          <Btn size="xs" variant="ghost" onClick={() => void load()}>
            Retry
          </Btn>
        </div>
      )}

      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <h2
            style={{ fontSize: 15, fontWeight: 700, color: T.text, margin: 0 }}
          >
            Virtual machines
          </h2>
          <div style={{ flex: 1 }} />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by name"
            style={{
              width: 250,
              padding: "8px 10px",
              background: T.raised,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              outline: "none",
              color: T.text,
              fontSize: 12,
            }}
          />
        </div>

        {loading ? (
          <div style={{ padding: 22, fontSize: 12, color: T.textDim }}>
            Loading virtual machines…
          </div>
        ) : filtered.length ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: T.bg }}>
                  {["Name", "Connection", "State", ""].map((label, index) => (
                    <th
                      key={index}
                      style={{
                        padding: "9px 16px",
                        textAlign: index === 3 ? "right" : "left",
                        fontSize: 10,
                        fontWeight: 700,
                        color: T.textDim,
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((machine) => (
                  <MachineRow
                    key={machine.name}
                    machine={machine}
                    busy={busy}
                    onAction={handleAction}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            style={{
              padding: 26,
              textAlign: "center",
              color: T.textDim,
              fontSize: 12,
            }}
          >
            {machines.length
              ? "No virtual machines match the filter."
              : "No virtual machines found on qemu:///system."}
          </div>
        )}
      </Card>
    </div>
  );
}
