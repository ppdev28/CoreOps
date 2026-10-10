import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  LayoutDashboard,
  Box,
  AppWindow,
  Layers,
  HardDrive,
  Network,
  Activity,
  ScrollText,
  Terminal,
  Shield,
  RefreshCw,
  Settings,
  Search,
  Bell,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Server,
  Globe,
  Copy,
  Check,
  AlertTriangle,
  Database,
  RotateCw,
  LogIn,
  CheckCircle2,
  Upload,
  X,
  Play,
  Square,
  FileText,
  MonitorCog,
} from "lucide-react";
import { T } from "../lib/tokens";
import type { View, ToastType } from "../lib/types";
import { Btn } from "./ui";

const NAV = [
  {
    items: [
      {
        id: "dashboard",
        label: "Dashboard",
        icon: <LayoutDashboard size={14} />,
      },
    ],
  },
  {
    group: "Infrastructure",
    items: [
      { id: "host", label: "Host", icon: <Server size={14} />, badge: "" },
      {
        id: "containers",
        label: "Containers",
        icon: <Box size={14} />,
        badge: "",
      },
      {
        id: "applications",
        label: "Applications",
        icon: <AppWindow size={14} />,
      },
      { id: "services", label: "Services", icon: <Layers size={14} /> },
      { id: "storage", label: "Storage", icon: <HardDrive size={14} /> },
      { id: "network", label: "Network", icon: <Network size={14} /> },
      {
        id: "virtual-machines",
        label: "Virtual machines",
        icon: <MonitorCog size={14} />,
      },
    ],
  },
  {
    group: "Observability",
    items: [
      { id: "monitoring", label: "Monitoring", icon: <Activity size={14} /> },
      { id: "logs", label: "Logs", icon: <ScrollText size={14} /> },
    ],
  },
  {
    group: "Tools",
    items: [
      { id: "terminal", label: "Terminal", icon: <Terminal size={14} /> },
    ],
  },
  {
    group: "System",
    items: [
      { id: "security", label: "Security", icon: <Shield size={14} /> },
      {
        id: "updates",
        label: "Updates",
        icon: <RefreshCw size={14} />,
        badge: "12",
      },
      { id: "settings", label: "Settings", icon: <Settings size={14} /> },
    ],
  },
];

export function Sidebar({
  view,
  onNavigate,
  collapsed,
  onToggle,
}: {
  view: View;
  onNavigate: (v: View) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const active = (id: string) =>
    view === id ||
    (view === "container-detail" && id === "containers") ||
    (view === "container-create" && id === "containers") ||
    (view === "app-detail" && id === "applications");
  return (
    <aside
      style={{
        width: collapsed ? 52 : 220,
        flexShrink: 0,
        background: T.bgSidebar,
        borderRight: `1px solid ${T.borderRight}`,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        transition: "width 180ms ease",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: collapsed ? "14px 14px" : "14px 16px",
          height: 52,
          flexShrink: 0,
          borderBottom: `1px solid ${T.borderRight}`,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            flexShrink: 0,
            background: "linear-gradient(155deg, rgb(0, 97, 255) 24.79%, rgba(19, 37, 54, 1) 34.45%, rgb(0, 149, 255) 84.87%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Server size={13} color="#fff" />
        </div>
        {!collapsed && (
          <>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: T.text,
                whiteSpace: "nowrap",
                flex: 1,
                overflow: "hidden",
              }}
            >
              CoreOps
            </span>
            <button
              onClick={onToggle}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: T.textDim,
                display: "flex",
                padding: 2,
                borderRadius: 4,
              }}
            >
              <ChevronLeft size={14} />
            </button>
          </>
        )}
        {collapsed && (
          <button
            onClick={onToggle}
            style={{
              position: "absolute",
              right: -12,
              top: "50%",
              transform: "translateY(-50%)",
              width: 20,
              height: 28,
              borderRadius: "0 6px 6px 0",
              background: T.overlay,
              border: `1px solid ${T.border}`,
              cursor: "pointer",
              color: T.textDim,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ChevronRight size={11} />
          </button>
        )}
      </div>
      <nav style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        {NAV.map((sec, si) => (
          <div key={si} style={{ marginBottom: 2 }}>
            {sec.group && !collapsed && (
              <div
                style={{
                  padding: "10px 16px 3px",
                  fontSize: 10,
                  fontWeight: 700,
                  color: T.textDim,
                  textTransform: "uppercase",
                  letterSpacing: ".09em",
                }}
              >
                {sec.group}
              </div>
            )}
            {sec.items.map((item) => {
              const isActive = active(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id as View)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    width: "100%",
                    padding: collapsed ? "7px 15px" : "7px 16px",
                    background: isActive ? T.active : "none",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    borderLeft: `2px solid ${isActive ? T.accent : "transparent"}`,
                    position: "relative",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = T.hover;
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "none";
                  }}
                >
                  <span
                    style={{
                      color: isActive ? T.accent : T.textDim,
                      display: "flex",
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </span>
                  {!collapsed && (
                    <span
                      style={{
                        fontSize: 13,
                        color: isActive ? T.text : T.textSub,
                        flex: 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.label}
                    </span>
                  )}
                  {!collapsed && (item as any).badge && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: T.accentHover,
                        color: "#fff",
                      }}
                    >
                      {(item as any).badge}
                    </span>
                  )}
                  {collapsed && (item as any).badge && (
                    <span
                      style={{
                        position: "absolute",
                        top: 5,
                        right: 6,
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: T.accent,
                        border: `1.5px solid ${T.bg}`,
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: collapsed ? "12px 15px" : "12px 16px",
          borderTop: `1px solid ${T.border}`,
        }}
      >
        <span
          className="pulse"
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: T.green,
            boxShadow: `0 0 8px ${T.green}`,
            flexShrink: 0,
          }}
        />
        {!collapsed && (
          <span style={{ fontSize: 11, color: T.textDim }}>Server online</span>
        )}
      </div>
    </aside>
  );
}

const NOTIFS = [
  {
    icon: AlertTriangle,
    color: "#f59e0b",
    label: "traefik is restarting",
    time: "2 min ago",
  },
  {
    icon: Upload,
    color: "#3b82f6",
    label: "12 system updates available",
    time: "3 hr ago",
  },
  {
    icon: LogIn,
    color: "#50586b",
    label: "SSH login — admin@192.168.1.42",
    time: "1 hr ago",
  },
  {
    icon: Database,
    color: "#22c55e",
    label: "Backup completed — 2.4 GB",
    time: "3 hr ago",
  },
];
export function Header({
  onCmd,
  onMenuToggle,
}: {
  onCmd: () => void;
  onMenuToggle: () => void;
}) {
  const [notifOpen, setNotifOpen] = useState(false),
    [userOpen, setUserOpen] = useState(false),
    [copied, setCopied] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null),
    userRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!notifRef.current?.contains(e.target as Node)) setNotifOpen(false);
      if (!userRef.current?.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const copy = () => {
    navigator.clipboard.writeText("homelab-server").catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <header
      style={{
        height: 52,
        background: T.bgHeader,
        borderBottom: `1px solid ${T.borderHeader}`,
        display: "flex",
        alignItems: "center",
        padding: "0 18px",
        gap: 10,
        flexShrink: 0,
      }}
    >
      <button
        onClick={onMenuToggle}
        className="mobile-menu-btn"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: T.textSub,
          display: "none",
          padding: 4,
          borderRadius: 6,
        }}
      >
        <LayoutDashboard size={16} />
      </button>
      <button
        onClick={copy}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          background: "none",
          border: "1px solid transparent",
          borderRadius: 7,
          cursor: "pointer",
        }}
      >
        <Globe size={12} color={T.textDim} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: T.text,
            fontFamily: "JetBrains Mono,monospace",
          }}
        >
          homelab-server
        </span>
        <ChevronDown size={11} color={T.textDim} />
        {copied ? (
          <Check size={11} color={T.green} />
        ) : (
          <Copy size={11} color={T.textDim} />
        )}
      </button>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "2px 8px",
          background: `${T.green}12`,
          borderRadius: 5,
          border: `1px solid ${T.green}28`,
        }}
      >
        <span
          className="pulse"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: T.green,
          }}
        />
        <span style={{ fontSize: 11, fontWeight: 600, color: T.green }}>
          Online
        </span>
      </div>
      <div style={{ flex: 1 }} />
      <button
        onClick={onCmd}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          background: T.raised,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          cursor: "pointer",
          color: T.textDim,
          fontSize: 12,
        }}
      >
        <Search size={12} />
        <span>Search…</span>
        <kbd
          style={{
            padding: "1px 5px",
            background: T.overlay,
            border: `1px solid ${T.border}`,
            borderRadius: 3,
            fontSize: 10,
            color: T.textDim,
          }}
        >
          ⌘ K
        </kbd>
      </button>
      <div ref={notifRef} style={{ position: "relative" }}>
        <button
          onClick={() => {
            setNotifOpen((o) => !o);
            setUserOpen(false);
          }}
          style={{
            position: "relative",
            width: 34,
            height: 34,
            borderRadius: 8,
            background: notifOpen ? T.active : "none",
            border: `1px solid ${notifOpen ? T.border : "transparent"}`,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: T.textSub,
          }}
        >
          <Bell size={15} />
          <span
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              width: 7,
              height: 7,
              background: T.red,
              borderRadius: "50%",
              border: `2px solid ${T.bg}`,
            }}
          />
        </button>
        {notifOpen && (
          <div
            className="anim-slide-down"
            style={{
              position: "absolute",
              top: 42,
              right: 0,
              width: 340,
              zIndex: 200,
              background: T.overlay,
              border: `1px solid ${T.borderStrong}`,
              borderRadius: 10,
              boxShadow: "0 12px 40px rgba(0,0,0,.5)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>
                Notifications
              </span>
              <button
                style={{
                  fontSize: 11,
                  color: T.accent,
                  background: "none",
                  border: "none",
                }}
              >
                Mark all read
              </button>
            </div>
            {NOTIFS.map((n, i) => {
              const Icon = n.icon;
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "11px 16px",
                    borderBottom: `1px solid ${T.borderMuted}`,
                  }}
                >
                  <span style={{ color: n.color, display: "flex" }}>
                    <Icon size={13} />
                  </span>
                  <div>
                    <div
                      style={{ fontSize: 12, fontWeight: 500, color: T.text }}
                    >
                      {n.label}
                    </div>
                    <div style={{ fontSize: 11, color: T.textDim }}>
                      {n.time}
                    </div>
                  </div>
                </div>
              );
            })}
            <div style={{ padding: "10px 16px" }}>
              <button
                style={{
                  fontSize: 11,
                  color: T.accent,
                  background: "none",
                  border: "none",
                }}
              >
                View all notifications
              </button>
            </div>
          </div>
        )}
      </div>
      <div ref={userRef} style={{ position: "relative" }}>
        <button
          onClick={() => {
            setUserOpen((o) => !o);
            setNotifOpen(false);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 8px 4px 4px",
            background: userOpen ? T.active : "none",
            border: `1px solid ${userOpen ? T.border : "transparent"}`,
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              color: "#fff",
            }}
          >
            A
          </div>
          <span style={{ fontSize: 12, fontWeight: 500, color: T.textSub }}>
            admin
          </span>
          <ChevronDown size={11} color={T.textDim} />
        </button>
        {userOpen && (
          <div
            className="anim-slide-down"
            style={{
              position: "absolute",
              top: 42,
              right: 0,
              width: 190,
              zIndex: 200,
              background: T.overlay,
              border: `1px solid ${T.borderStrong}`,
              borderRadius: 9,
              boxShadow: "0 12px 40px rgba(0,0,0,.5)",
              padding: "4px 0",
            }}
          >
            <div
              style={{
                padding: "10px 14px 8px",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
                admin
              </div>
              <div style={{ fontSize: 11, color: T.textDim }}>
                root@homelab-server
              </div>
            </div>
            {["Profile", "SSH Keys", "API Tokens", "—", "Sign out"].map(
              (item, i) =>
                item === "—" ? (
                  <div
                    key={i}
                    style={{ height: 1, background: T.border, margin: "4px 0" }}
                  />
                ) : (
                  <button
                    key={item}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "7px 14px",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 12,
                      color: item === "Sign out" ? T.red : T.textSub,
                    }}
                  >
                    {item}
                  </button>
                ),
            )}
          </div>
        )}
      </div>
    </header>
  );
}

const CMD_NAV = [
  {
    label: "Dashboard",
    sub: "System overview",
    view: "dashboard" as View,
    icon: <LayoutDashboard size={13} />,
  },
  {
    label: "Host",
    sub: "Linux host overview",
    view: "host" as View,
    icon: <Server size={13} />,
  },
  {
    label: "Containers",
    sub: "Docker container manager",
    view: "containers" as View,
    icon: <Box size={13} />,
  },
  {
    label: "Applications",
    sub: "Installed apps",
    view: "applications" as View,
    icon: <AppWindow size={13} />,
  },
  {
    label: "Monitoring",
    sub: "Metrics & charts",
    view: "monitoring" as View,
    icon: <Activity size={13} />,
  },
  {
    label: "Logs",
    sub: "Log explorer",
    view: "logs" as View,
    icon: <ScrollText size={13} />,
  },
  {
    label: "Terminal",
    sub: "SSH terminal",
    view: "terminal" as View,
    icon: <Terminal size={13} />,
  },
  {
    label: "Storage",
    sub: "Disks & volumes",
    view: "storage" as View,
    icon: <HardDrive size={13} />,
  },
  {
    label: "Network",
    sub: "Interfaces & ports",
    view: "network" as View,
    icon: <Network size={13} />,
  },
  {
    label: "Virtual machines",
    sub: "QEMU / libvirt virtual machines",
    view: "virtual-machines" as View,
    icon: <MonitorCog size={13} />,
  },
  {
    label: "Security",
    sub: "Firewall & audit",
    view: "security" as View,
    icon: <Shield size={13} />,
  },
  {
    label: "Updates",
    sub: "System packages",
    view: "updates" as View,
    icon: <RefreshCw size={13} />,
  },
  {
    label: "Settings",
    sub: "Configuration",
    view: "settings" as View,
    icon: <Settings size={13} />,
  },
];
const CMD_ACTIONS = [
  {
    label: "Restart container",
    sub: "Choose a running container",
    icon: <RotateCw size={13} />,
  },
  {
    label: "Stop container",
    sub: "Choose a running container",
    icon: <Square size={13} />,
  },
  {
    label: "Start container",
    sub: "Choose a stopped container",
    icon: <Play size={13} />,
  },
  {
    label: "View system logs",
    sub: "Open centralized log viewer",
    icon: <ScrollText size={13} />,
  },
  {
    label: "Check for updates",
    sub: "Scan for package updates",
    icon: <RefreshCw size={13} />,
  },
  {
    label: "Open terminal",
    sub: "SSH to homelab-server",
    icon: <Terminal size={13} />,
  },
];
export function CommandPalette({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (v: View) => void;
}) {
  const [q, setQ] = useState(""),
    [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const allItems = [
    ...CMD_NAV.map((i) => ({ ...i, type: "nav" })),
    ...CMD_ACTIONS.map((i) => ({ ...i, view: null as any, type: "action" })),
  ];
  const filtered = q
    ? allItems.filter(
        (i) =>
          i.label.toLowerCase().includes(q.toLowerCase()) ||
          i.sub.toLowerCase().includes(q.toLowerCase()),
      )
    : allItems;
  const navItems = filtered.filter((i) => i.type === "nav"),
    actionItems = filtered.filter((i) => i.type === "action"),
    recent = q ? [] : CMD_NAV.slice(0, 4);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      }
      if (e.key === "Enter" && filtered[sel]?.view) {
        onNavigate(filtered[sel].view);
        onClose();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [filtered, sel, onNavigate, onClose]);
  const Row = ({
    item,
    idx,
    isRecent = false,
  }: {
    item: any;
    idx: number;
    isRecent?: boolean;
  }) => (
    <button
      onClick={() => {
        if (item.view) {
          onNavigate(item.view);
          onClose();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        padding: "9px 14px",
        background: idx === sel && !isRecent ? T.hover : "none",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
      }}
      onMouseEnter={() => setSel(idx)}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: T.bg,
          border: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: T.textSub,
          flexShrink: 0,
        }}
      >
        {item.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: T.text }}>
          {item.label}
        </div>
        <div style={{ fontSize: 11, color: T.textDim }}>{item.sub}</div>
      </div>
      {item.type === "nav" && <ChevronRight size={11} color={T.textDim} />}
    </button>
  );
  return (
    <div className="cmd-backdrop" onClick={onClose}>
      <div
        className="anim-slide-down"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 600,
          background: T.overlay,
          border: `1px solid ${T.borderStrong}`,
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 32px 80px rgba(0,0,0,.7)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <Search size={14} color={T.textDim} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search or run a command…"
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: T.text,
              fontSize: 14,
            }}
          />
          <kbd
            style={{
              padding: "2px 6px",
              background: T.bg,
              border: `1px solid ${T.border}`,
              borderRadius: 4,
              fontSize: 11,
              color: T.textDim,
            }}
          >
            esc
          </kbd>
        </div>
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          {!q && (
            <>
              <div
                style={{
                  padding: "8px 14px 2px",
                  fontSize: 10,
                  fontWeight: 700,
                  color: T.textDim,
                  textTransform: "uppercase",
                }}
              >
                Recent
              </div>
              {recent.map((item, i) => (
                <Row
                  key={item.view}
                  item={{ ...item, type: "nav" }}
                  idx={i}
                  isRecent
                />
              ))}
              <div
                style={{ height: 1, background: T.border, margin: "4px 0" }}
              />
              <div
                style={{
                  padding: "8px 14px 2px",
                  fontSize: 10,
                  fontWeight: 700,
                  color: T.textDim,
                  textTransform: "uppercase",
                }}
              >
                Navigation
              </div>
              {CMD_NAV.slice(4).map((item, i) => (
                <Row
                  key={item.view}
                  item={{ ...item, type: "nav" }}
                  idx={i + 4}
                />
              ))}
            </>
          )}
          {q && filtered.length === 0 && (
            <div
              style={{
                padding: "40px 24px",
                textAlign: "center",
                color: T.textDim,
              }}
            >
              No results for "{q}"
            </div>
          )}
          {q && navItems.length > 0 && (
            <>
              <div
                style={{
                  padding: "8px 14px 2px",
                  fontSize: 10,
                  fontWeight: 700,
                  color: T.textDim,
                  textTransform: "uppercase",
                }}
              >
                Pages
              </div>
              {navItems.map((item, i) => (
                <Row key={item.label} item={item} idx={i} />
              ))}
            </>
          )}
          {q && actionItems.length > 0 && (
            <>
              {navItems.length > 0 && (
                <>
                  <div
                    style={{ height: 1, background: T.border, margin: "4px 0" }}
                  />
                  <div
                    style={{
                      padding: "8px 14px 2px",
                      fontSize: 10,
                      fontWeight: 700,
                      color: T.textDim,
                      textTransform: "uppercase",
                    }}
                  >
                    Commands
                  </div>
                </>
              )}
              {actionItems.map((item, i) => (
                <Row key={item.label} item={item} idx={i + navItems.length} />
              ))}
            </>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 14,
            padding: "8px 16px",
            borderTop: `1px solid ${T.border}`,
            background: T.bg,
          }}
        >
          {[
            ["↑↓", "Navigate"],
            ["↵", "Open"],
            ["esc", "Close"],
          ].map(([k, l]) => (
            <div
              key={k}
              style={{ display: "flex", alignItems: "center", gap: 5 }}
            >
              <kbd
                style={{
                  padding: "1px 5px",
                  background: T.overlay,
                  border: `1px solid ${T.border}`,
                  borderRadius: 3,
                  fontSize: 10,
                  color: T.textDim,
                }}
              >
                {k}
              </kbd>
              <span style={{ fontSize: 11, color: T.textDim }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
