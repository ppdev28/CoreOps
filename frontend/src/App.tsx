import { Component, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Wifi,
  AlertTriangle,
  CheckCircle2,
  Activity,
  ScrollText,
  Terminal,
  RefreshCw,
  Database,
  LogIn,
  RotateCw,
  ArrowRight,
  Clock,
  Zap,
  Thermometer,
  Globe,
  MonitorDot,
  Plus,
} from "lucide-react";
import { T } from "./lib/tokens";
import type {
  View,
  ContainerStatus,
  ToastType,
  ConfirmDialog,
  Toast,
} from "./lib/types";
import {
  Sparkline,
  Card,
  CardHeader,
  Btn,
  QuickAction,
  ToastStack,
  ConfirmDialogModal,
  ResourceChart,
} from "./components/ui";
import { Sidebar, Header, CommandPalette } from "./components/shell";
import ContainersView from "./views/ContainersView";
import ContainerDetail from "./views/ContainerDetail";
import HostView from "./views/HostView";
import ApplicationsView from "./views/ApplicationsView";
import ServicesView from "./views/ServicesView";
import StorageView from "./views/StorageView";
import NetworkView from "./views/NetworkView";
import VirtualMachinesView from "./views/VirtualMachinesView";
import MonitoringView from "./views/MonitoringView";
import LogsView from "./views/LogsView";
import TerminalView from "./views/TerminalView";
import SecurityView from "./views/SecurityView";
import UpdatesView from "./views/UpdatesView";
import SettingsView from "./views/SettingsView";
import RealDashboardView from "./views/DashboardView";
import { loadWebSettings, subscribeWebSettings } from "./lib/webSettings";

const SPARKLINE_CPU = [8, 14, 22, 18, 31, 27, 23, 28, 20, 23];
const SPARKLINE_MEM = [40, 42, 45, 44, 48, 50, 47, 46, 49, 48];
const SPARKLINE_NET = [0.8, 1.4, 0.9, 2.5, 1.8, 2.4, 1.6, 2.2, 1.9, 2.4];
const DASH_CONTAINERS = [
  {
    id: "c1",
    name: "nginx",
    status: "running" as ContainerStatus,
    cpu: "0.4%",
    mem: "18 MB",
    healthy: true,
  },
  {
    id: "c2",
    name: "postgres",
    status: "running" as ContainerStatus,
    cpu: "1.2%",
    mem: "142 MB",
    healthy: true,
  },
  {
    id: "c3",
    name: "redis",
    status: "running" as ContainerStatus,
    cpu: "0.1%",
    mem: "12 MB",
    healthy: true,
  },
  {
    id: "c4",
    name: "nextcloud",
    status: "running" as ContainerStatus,
    cpu: "0.8%",
    mem: "311 MB",
    healthy: true,
  },
  {
    id: "c5",
    name: "traefik",
    status: "restarting" as ContainerStatus,
    cpu: "1.8%",
    mem: "42 MB",
    healthy: false,
  },
];
const ACTIVITY = [
  {
    icon: Database,
    color: "#22c55e",
    label: "Backup completed",
    detail: "postgres dump — 2.4 GB to /mnt/backup",
    time: "2 min ago",
  },
  {
    icon: RotateCw,
    color: "#f59e0b",
    label: "nginx restarted",
    detail: "Health check failed — auto-restart triggered",
    time: "18 min ago",
  },
  {
    icon: LogIn,
    color: "#50586b",
    label: "SSH login detected",
    detail: "admin via key auth — 192.168.1.42",
    time: "1 hour ago",
  },
  {
    icon: AlertTriangle,
    color: "#3b82f6",
    label: "System update available",
    detail: "12 packages — Ubuntu 24.04 LTS",
    time: "3 hours ago",
  },
  {
    icon: CheckCircle2,
    color: "#22c55e",
    label: "Health check passed",
    detail: "All nextcloud endpoints healthy",
    time: "4 hours ago",
  },
];
const ISSUES = [
  {
    label: "traefik is restarting",
    detail: "4 restarts in the last 22 minutes",
  },
];

function StatusDotInline({ status }: { status: ContainerStatus }) {
  const colors: Record<ContainerStatus, string> = {
    running: "#22c55e",
    stopped: "#50586b",
    paused: "#f59e0b",
    restarting: "#f59e0b",
    exited: "#ef4444",
  };
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: colors[status],
        flexShrink: 0,
        boxShadow:
          status === "running" ? `0 0 0 2px ${colors[status]}28` : "none",
      }}
    />
  );
}
function DashMetricCard({
  label,
  value,
  sub,
  icon,
  color,
  variant = "sparkline",
  spark,
  storagePct,
  netDown,
  netUp,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
  color: string;
  variant?: "sparkline" | "storage" | "network";
  spark?: number[];
  storagePct?: number;
  netDown?: string;
  netUp?: string;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? T.hover : T.raised,
        border: `1px solid ${hov ? T.borderStrong : T.border}`,
        borderRadius: 9,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        cursor: "default",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: T.textDim, display: "flex" }}>{icon}</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: T.textDim,
              textTransform: "uppercase",
              letterSpacing: ".07em",
            }}
          >
            {label}
          </span>
        </div>
        {variant === "sparkline" && spark && (
          <Sparkline data={spark} color={color} w={60} h={24} />
        )}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: T.text,
          fontFamily: "JetBrains Mono,monospace",
          letterSpacing: "-.03em",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {variant === "sparkline" && sub && (
        <div
          style={{
            fontSize: 11,
            color: T.textDim,
            fontFamily: "JetBrains Mono,monospace",
          }}
        >
          {sub}
        </div>
      )}
      {variant === "storage" && storagePct != null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div
            style={{
              height: 3,
              background: T.bg,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: 2,
                width: `${storagePct}%`,
                background:
                  storagePct > 85 ? T.red : storagePct > 70 ? T.yellow : color,
              }}
            />
          </div>
          {sub && (
            <div
              style={{
                fontSize: 11,
                color: T.textDim,
                fontFamily: "JetBrains Mono,monospace",
              }}
            >
              {sub}
            </div>
          )}
        </div>
      )}
      {variant === "network" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: T.textDim, width: 8 }}>↓</span>
            <span
              style={{
                fontSize: 11,
                color: T.green,
                fontFamily: "JetBrains Mono,monospace",
                fontWeight: 500,
              }}
            >
              {netDown}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: T.textDim, width: 8 }}>↑</span>
            <span
              style={{
                fontSize: 11,
                color: T.textSub,
                fontFamily: "JetBrains Mono,monospace",
                fontWeight: 500,
              }}
            >
              {netUp}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
function HealthStatus({
  issues,
}: {
  issues: { label: string; detail: string }[];
}) {
  const ok = issues.length === 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: ok ? "7px 14px" : "10px 14px",
        background: ok ? "transparent" : `${T.yellow}0d`,
        border: `1px solid ${ok ? T.borderMuted : `${T.yellow}35`}`,
        borderRadius: 8,
      }}
    >
      {ok ? (
        <>
          <CheckCircle2 size={13} color={T.green} />
          <span style={{ fontSize: 12, color: T.textSub }}>
            All systems operational
          </span>
          <span
            style={{
              fontSize: 11,
              color: T.textDim,
              marginLeft: "auto",
              fontFamily: "JetBrains Mono,monospace",
            }}
          >
            Updated a few seconds ago
          </span>
        </>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={13} color={T.yellow} />
            <span style={{ fontSize: 12, fontWeight: 600, color: T.yellow }}>
              {issues.length}{" "}
              {issues.length === 1 ? "issue requires" : "issues require"}{" "}
              attention
            </span>
          </div>
          {issues.map((iss, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingLeft: 21,
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: T.yellow,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 11, color: T.textSub }}>
                {iss.label}
              </span>
              <span style={{ fontSize: 11, color: T.textDim }}>
                — {iss.detail}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function ContainerRowDash({
  c,
  onClick,
}: {
  c: (typeof DASH_CONTAINERS)[0];
  onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  const bad = !c.healthy || c.status !== "running";
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        background: hov ? T.hover : bad ? `${T.yellow}08` : "transparent",
        borderBottom: `1px solid ${T.borderMuted}`,
        cursor: "pointer",
      }}
    >
      <StatusDotInline status={c.status} />
      <span
        style={{
          flex: 1,
          fontSize: 12,
          fontWeight: 600,
          color: T.text,
          fontFamily: "JetBrains Mono,monospace",
        }}
      >
        {c.name}
      </span>
      {bad && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "1px 6px",
            borderRadius: 4,
            background: `${T.yellow}18`,
            border: `1px solid ${T.yellow}35`,
            color: T.yellow,
          }}
        >
          restarting
        </span>
      )}
      <span
        style={{
          fontSize: 11,
          color: T.textDim,
          fontFamily: "JetBrains Mono,monospace",
          width: 36,
          textAlign: "right",
        }}
      >
        {c.cpu}
      </span>
      <span
        style={{
          fontSize: 11,
          color: T.textDim,
          fontFamily: "JetBrains Mono,monospace",
          width: 52,
          textAlign: "right",
        }}
      >
        {c.mem}
      </span>
    </div>
  );
}
function ActivityItem({
  item,
  last,
}: {
  item: (typeof ACTIVITY)[0];
  last: boolean;
}) {
  const Icon = item.icon;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "9px 14px",
        borderBottom: last ? "none" : `1px solid ${T.borderMuted}`,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          flexShrink: 0,
          marginTop: 1,
          background: `${item.color}14`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: item.color,
        }}
      >
        <Icon size={11} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 500, color: T.text }}>
            {item.label}
          </span>
          <span
            style={{
              fontSize: 10,
              color: T.textDim,
              flexShrink: 0,
              fontFamily: "JetBrains Mono,monospace",
            }}
          >
            {item.time}
          </span>
        </div>
        <div
          style={{
            fontSize: 11,
            color: T.textDim,
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.detail}
        </div>
      </div>
    </div>
  );
}
function DashboardView({
  onNavigate,
  addToast,
}: {
  onNavigate: (v: View) => void;
  addToast: (m: string, t: ToastType) => void;
}) {
  return (
    <div style={{ padding: "20px 24px", maxWidth: 1400, width: "100%" }}>
      <div style={{ marginBottom: 14 }}>
        <HealthStatus issues={ISSUES} />
      </div>
      <div
        className="dash-metrics"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <DashMetricCard
          label="CPU"
          value="23%"
          sub="8 cores · load 0.42"
          icon={<Cpu size={13} />}
          color={T.accent}
          spark={SPARKLINE_CPU}
        />
        <DashMetricCard
          label="Memory"
          value="48%"
          sub="7.7 GB / 16 GB"
          icon={<MemoryStick size={13} />}
          color="#a78bfa"
          spark={SPARKLINE_MEM}
        />
        <DashMetricCard
          label="Storage"
          value="61%"
          sub="612 GB / 1 TB"
          icon={<HardDrive size={13} />}
          color={T.yellow}
          variant="storage"
          storagePct={61}
        />
        <DashMetricCard
          label="Network"
          value="2.4 MB/s"
          icon={<Wifi size={13} />}
          color={T.green}
          variant="network"
          netDown="2.4 MB/s"
          netUp="840 KB/s"
        />
      </div>
      <div
        className="dash-charts"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 260px",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <ResourceChart
          label="CPU Usage"
          color={T.accent}
          base={23}
          noise={18}
          seed={0.42}
        />
        <ResourceChart
          label="Memory Usage"
          color="#a78bfa"
          base={48}
          noise={8}
          seed={0.73}
        />
        <div onClick={() => onNavigate("host")} style={{ cursor: "pointer" }}>
          <Card>
            <CardHeader title="System" />
            <div
              style={{
                padding: "10px 14px 8px",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: T.text,
                  marginBottom: 2,
                }}
              >
                Ubuntu 24.04 LTS
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: T.textDim,
                  fontFamily: "JetBrains Mono,monospace",
                }}
              >
                x86_64 · homelab-server
              </div>
            </div>
            <div>
              {[
                { k: "Kernel", v: "6.8.0-47", icon: <Zap size={10} /> },
                { k: "Uptime", v: "14d 08h", icon: <Clock size={10} /> },
                { k: "Load avg", v: "0.42", icon: <Activity size={10} /> },
                { k: "Temp", v: "48°C", icon: <Thermometer size={10} /> },
                {
                  k: "Last boot",
                  v: "Jul 29, 04:21",
                  icon: <MonitorDot size={10} />,
                },
                { k: "IP", v: "192.168.1.10", icon: <Globe size={10} /> },
              ].map((row) => (
                <div
                  key={row.k}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "5px 14px",
                    borderBottom: `1px solid ${T.borderMuted}`,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 5 }}
                  >
                    <span style={{ color: T.textDim, display: "flex" }}>
                      {row.icon}
                    </span>
                    <span style={{ fontSize: 11, color: T.textDim }}>
                      {row.k}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: T.textSub,
                      fontFamily: "JetBrains Mono,monospace",
                    }}
                  >
                    {row.v}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <div
        className="dash-bottom"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 260px 192px",
          gap: 12,
        }}
      >
        <Card>
          <CardHeader
            title="Containers"
            action={
              <button
                onClick={() => onNavigate("containers")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 11,
                  color: T.textDim,
                  fontWeight: 500,
                }}
              >
                View all <ArrowRight size={11} />
              </button>
            }
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "5px 14px 4px",
              borderBottom: `1px solid ${T.border}`,
            }}
          >
            <span style={{ width: 7 }} />
            <span
              style={{
                flex: 1,
                fontSize: 10,
                fontWeight: 700,
                color: T.textDim,
                textTransform: "uppercase",
              }}
            >
              Name
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: T.textDim,
                width: 36,
                textAlign: "right",
              }}
            >
              CPU
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: T.textDim,
                width: 52,
                textAlign: "right",
              }}
            >
              Mem
            </span>
          </div>
          {DASH_CONTAINERS.map((c) => (
            <ContainerRowDash
              key={c.id}
              c={c}
              onClick={() => onNavigate("container-detail")}
            />
          ))}
        </Card>
        <Card>
          <CardHeader
            title="Recent activity"
            action={
              <button
                onClick={() => onNavigate("logs")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 11,
                  color: T.textDim,
                }}
              >
                View all <ArrowRight size={11} />
              </button>
            }
          />
          {ACTIVITY.map((item, i) => (
            <ActivityItem
              key={item.label}
              item={item}
              last={i === ACTIVITY.length - 1}
            />
          ))}
        </Card>
        <Card>
          <CardHeader title="Quick actions" />
          <div
            style={{
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}
          >
            <QuickAction
              label="Create container"
              icon={<Plus size={12} />}
              onClick={() => addToast("Create container — coming soon", "info")}
            />
            <QuickAction
              label="Open terminal"
              icon={<Terminal size={12} />}
              onClick={() => onNavigate("terminal")}
            />
            <QuickAction
              label="View logs"
              icon={<ScrollText size={12} />}
              onClick={() => onNavigate("logs")}
            />
            <QuickAction
              label="Check updates"
              icon={<RefreshCw size={12} />}
              onClick={() => onNavigate("updates")}
            />
          </div>
          <div
            style={{
              margin: "4px 10px 10px",
              padding: "10px 12px",
              background: T.bg,
              border: `1px solid ${T.border}`,
              borderRadius: 7,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: T.textDim,
                textTransform: "uppercase",
                letterSpacing: ".08em",
                marginBottom: 7,
              }}
            >
              At a glance
            </div>
            {[
              {
                label: "Running",
                value: String(
                  DASH_CONTAINERS.filter((c) => c.status === "running").length,
                ),
                color: T.green,
              },
              {
                label: "Unhealthy",
                value: String(DASH_CONTAINERS.filter((c) => !c.healthy).length),
                color: T.yellow,
              },
              { label: "Updates", value: "12", color: T.accent },
            ].map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "3px 0",
                  borderBottom: `1px solid ${T.borderMuted}`,
                }}
              >
                <span style={{ fontSize: 11, color: T.textDim }}>
                  {row.label}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: row.color,
                    fontFamily: "JetBrains Mono,monospace",
                  }}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

class TerminalErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "#1c1e25",
            color: "#eaecf0",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 12,
          }}
        >
          <div style={{ maxWidth: 720 }}>
            <div style={{ color: "#ef4444", fontWeight: 700, marginBottom: 8 }}>
              Terminal crashed while rendering
            </div>
            <div>{this.state.error.message}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [view, setView] = useState<View>("dashboard"),
    [collapsed, setCollapsed] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false),
    [showCmd, setShowCmd] = useState(false),
    [toasts, setToasts] = useState<Toast[]>([]),
    [confirm, setConfirm] = useState<ConfirmDialog | null>(null),
    [settings, setSettings] = useState(loadWebSettings);
  useEffect(() => subscribeWebSettings(setSettings), []);
  const playNotificationSound = useCallback(() => {
    try {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.035;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
      osc.addEventListener("ended", () => void ctx.close());
    } catch {}
  }, []);
  const addToast = useCallback(
    (message: string, type: ToastType = "info") => {
      if (!settings.notifications) return;
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, message, type }]);
      if (settings.sound) playNotificationSound();
      setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        3800,
      );
    },
    [settings.notifications, settings.sound, playNotificationSound],
  );
  const removeToast = useCallback(
    (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    [],
  );
  const navigate = useCallback((v: View) => {
    setView(v);
    setMobileOpen(false);
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k" &&
        settings.shortcuts
      ) {
        e.preventDefault();
        setShowCmd((v) => !v);
      }
      if (e.key === "Escape") setShowCmd(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [settings.shortcuts]);
  const requestConfirm = useCallback(
    (dialog: ConfirmDialog) => {
      if (settings.confirmDestructive) setConfirm(dialog);
      else dialog.onConfirm();
    },
    [settings.confirmDestructive],
  );
  const shell = { addToast, onConfirm: requestConfirm };
  return (
    <>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@keyframes slideDown{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}@keyframes toastIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}.anim-slide-down{animation:slideDown 140ms ease}.anim-toast-in{animation:toastIn 160ms ease}.pulse{animation:pulse 2s infinite}.cmd-backdrop{position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.65);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding-top:72px;animation:fadeIn 100ms ease}.toast-stack{position:fixed;bottom:20px;right:20px;display:flex;flex-direction:column;gap:8px;z-index:1001;pointer-events:none}@media(max-width:900px){.sidebar-desktop{display:none!important}.mobile-menu-btn{display:flex!important}.dash-metrics{grid-template-columns:repeat(2,1fr)!important}.dash-charts{grid-template-columns:1fr!important}.dash-bottom{grid-template-columns:1fr!important}.host-stats{grid-template-columns:1fr!important}.host-grid{grid-template-columns:1fr!important}}`}</style>
      <div
        style={{
          display: "flex",
          height: "100vh",
          background: T.bg,
          overflow: "hidden",
        }}
      >
        {showCmd && (
          <CommandPalette
            onClose={() => setShowCmd(false)}
            onNavigate={(v) => {
              navigate(v);
              setShowCmd(false);
            }}
          />
        )}
        {confirm && (
          <ConfirmDialogModal
            dialog={confirm}
            onClose={() => setConfirm(null)}
          />
        )}
        <ToastStack toasts={toasts} onRemove={removeToast} />
        <div
          className="sidebar-desktop"
          style={{ flexShrink: 0, position: "relative" }}
        >
          <Sidebar
            view={view}
            onNavigate={navigate}
            collapsed={collapsed}
            onToggle={() => setCollapsed((v) => !v)}
          />
        </div>
        {mobileOpen && (
          <>
            <div
              onClick={() => setMobileOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,.55)",
                zIndex: 100,
              }}
            />
            <div
              style={{
                position: "fixed",
                left: 0,
                top: 0,
                height: "100%",
                zIndex: 101,
                display: "flex",
              }}
            >
              <Sidebar
                view={view}
                onNavigate={navigate}
                collapsed={false}
                onToggle={() => setMobileOpen(false)}
              />
            </div>
          </>
        )}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          <Header
            onCmd={() => setShowCmd(true)}
            onMenuToggle={() => setMobileOpen((v) => !v)}
          />
          <main
            style={{
              flex: 1,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {view === "dashboard" && (
              <RealDashboardView onNavigate={navigate} addToast={addToast} />
            )}{" "}
            {view === "host" && <HostView />}{" "}
            {view === "containers" && (
              <ContainersView
                onDetail={() => navigate("container-detail")}
                {...shell}
              />
            )}{" "}
            {view === "container-detail" && (
              <ContainerDetail
                onBack={() => navigate("containers")}
                {...shell}
              />
            )}{" "}
            {view === "applications" && (
              <ApplicationsView
                onDetail={() => navigate("app-detail")}
                addToast={addToast}
              />
            )}{" "}
            {view === "app-detail" && <ApplicationsView addToast={addToast} />}{" "}
            {view === "services" && <ServicesView {...shell} />}{" "}
            {view === "storage" && <StorageView {...shell} />}{" "}
            {view === "network" && <NetworkView />}{" "}
            {view === "virtual-machines" && (
              <VirtualMachinesView addToast={addToast} />
            )}{" "}
            {view === "monitoring" && <MonitoringView />}{" "}
            {view === "logs" && <LogsView />}{" "}
            {view === "terminal" && (
              <TerminalErrorBoundary>
                <TerminalView />
              </TerminalErrorBoundary>
            )}{" "}
            {view === "security" && <SecurityView addToast={addToast} />}{" "}
            {view === "updates" && <UpdatesView {...shell} />}{" "}
            {view === "settings" && <SettingsView addToast={addToast} />}
          </main>
        </div>
      </div>
    </>
  );
}
