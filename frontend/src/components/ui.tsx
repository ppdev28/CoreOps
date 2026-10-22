import { useState, type ReactNode, type CSSProperties } from "react";
import { ArrowRight, AlertTriangle, X, Check } from "lucide-react";
import { T, STATUS_MAP, HEALTH_MAP } from "../lib/tokens";
import type {
  ContainerStatus,
  HealthStatus,
  ToastType,
  ConfirmDialog,
  Toast,
} from "../lib/types";

// ─── Sparkline (SVG) ──────────────────────────────────────────────────────────

export function Sparkline({
  data,
  color,
  w = 60,
  h = 24,
}: {
  data: number[];
  color: string;
  w?: number;
  h?: number;
}) {
  const min = Math.min(...data),
    max = Math.max(...data),
    range = max - min || 1;
  const p = { x: 1, y: 2 };
  const pts = data.map((v, i) => ({
    x: p.x + (i / (data.length - 1)) * (w - p.x * 2),
    y: p.y + (1 - (v - min) / range) * (h - p.y * 2),
  }));
  const d = pts
    .map((pt, i) => (i === 0 ? `M${pt.x},${pt.y}` : `L${pt.x},${pt.y}`))
    .join(" ");
  const fill = `${d} L${pts[pts.length - 1].x},${h} L${pts[0].x},${h} Z`;
  const uid = color.replace("#", "");
  return (
    <svg width={w} height={h} style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id={`sp-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#sp-${uid})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── StatusDot ────────────────────────────────────────────────────────────────

export function StatusDot({
  status,
  size = 7,
}: {
  status: ContainerStatus;
  size?: number;
}) {
  const s = STATUS_MAP[status];
  return (
    <span
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        borderRadius: "50%",
        background: s.color,
        flexShrink: 0,
        boxShadow: s.pulse ? `0 0 0 2px ${s.color}28` : "none",
      }}
    />
  );
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: ContainerStatus }) {
  const s = STATUS_MAP[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 7px",
        borderRadius: 4,
        background: s.bg,
        border: `1px solid ${s.color}30`,
      }}
    >
      <StatusDot status={status} size={5} />
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: s.color,
          letterSpacing: "0.02em",
        }}
      >
        {s.label}
      </span>
    </span>
  );
}

// ─── HealthBadge ──────────────────────────────────────────────────────────────

export function HealthBadge({ health }: { health: HealthStatus }) {
  const h = HEALTH_MAP[health];
  if (health === "none")
    return <span style={{ fontSize: 11, color: T.textDim }}>—</span>;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 7px",
        borderRadius: 4,
        background: `${h.color}14`,
        border: `1px solid ${h.color}28`,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: h.color,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 11, fontWeight: 600, color: h.color }}>
        {h.label}
      </span>
    </span>
  );
}

// ─── Btn ──────────────────────────────────────────────────────────────────────

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "warning";
type BtnSize = "xs" | "sm" | "md";

export function Btn({
  children,
  onClick,
  variant = "secondary",
  size = "sm",
  icon,
  disabled,
  style,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: ReactNode;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const [hov, setHov] = useState(false);
  const vs: Record<
    BtnVariant,
    { bg: string; color: string; border: string; hbg: string }
  > = {
    primary: {
      bg: T.accent,
      color: "#fff",
      border: T.accent,
      hbg: T.accentHover,
    },
    secondary: {
      bg: T.overlay,
      color: T.textSub,
      border: T.border,
      hbg: T.hover,
    },
    ghost: {
      bg: "transparent",
      color: T.textSub,
      border: "transparent",
      hbg: T.hover,
    },
    danger: {
      bg: `${T.red}18`,
      color: T.red,
      border: `${T.red}38`,
      hbg: `${T.red}28`,
    },
    warning: {
      bg: `${T.yellow}18`,
      color: T.yellow,
      border: `${T.yellow}38`,
      hbg: `${T.yellow}28`,
    },
  };
  const sz = {
    xs: { p: "3px 8px", fs: 11 },
    sm: { p: "5px 11px", fs: 12 },
    md: { p: "7px 15px", fs: 13 },
  }[size];
  const v = vs[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: sz.p,
        fontSize: sz.fs,
        fontWeight: 500,
        fontFamily: "Inter,sans-serif",
        background: hov ? v.hbg : v.bg,
        color: v.color,
        border: `1px solid ${v.border}`,
        borderRadius: 7,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
        lineHeight: 1.4,
        transition: "background 100ms,color 100ms,border-color 100ms",
        ...style,
      }}
    >
      {icon && (
        <span style={{ display: "flex", alignItems: "center" }}>{icon}</span>
      )}
      {children}
    </button>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: T.raised,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  action,
  sub,
}: {
  title: string;
  action?: ReactNode;
  sub?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
          {title}
        </div>
        {sub && (
          <div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>
            {sub}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (t: string) => void;
}) {
  return (
    <div style={{ display: "flex", borderBottom: `1px solid ${T.border}` }}>
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          style={{
            padding: "8px 14px",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "Inter,sans-serif",
            color: active === t ? T.text : T.textDim,
            borderBottom: `2px solid ${active === t ? T.accent : "transparent"}`,
            marginBottom: -1,
            transition: "color 100ms",
          }}
          onMouseEnter={(e) => {
            if (active !== t) e.currentTarget.style.color = T.textSub;
          }}
          onMouseLeave={(e) => {
            if (active !== t) e.currentTarget.style.color = T.textDim;
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ─── Table helpers ────────────────────────────────────────────────────────────

export function Th({
  children,
  mono,
  right,
}: {
  children?: ReactNode;
  mono?: boolean;
  right?: boolean;
}) {
  return (
    <th
      style={{
        padding: "8px 14px",
        textAlign: right ? "right" : "left",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: T.textDim,
        textTransform: "uppercase",
        fontFamily: mono ? "JetBrains Mono,monospace" : undefined,
        whiteSpace: "nowrap",
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  mono,
  dim,
  right,
  style,
}: {
  children?: ReactNode;
  mono?: boolean;
  dim?: boolean;
  right?: boolean;
  style?: CSSProperties;
}) {
  return (
    <td
      style={{
        padding: "9px 14px",
        fontSize: 12,
        color: dim ? T.textDim : T.textSub,
        fontFamily: mono ? "JetBrains Mono,monospace" : undefined,
        borderBottom: `1px solid ${T.borderMuted}`,
        textAlign: right ? "right" : "left",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

export function Input({
  value,
  onChange,
  placeholder,
  icon,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: ReactNode;
  style?: CSSProperties;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        ...style,
      }}
    >
      {icon && (
        <span
          style={{
            position: "absolute",
            left: 10,
            color: T.textDim,
            display: "flex",
            pointerEvents: "none",
          }}
        >
          {icon}
        </span>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          paddingLeft: icon ? 30 : 10,
          paddingRight: 10,
          height: 32,
          background: T.raised,
          border: `1px solid ${focused ? T.accent : T.border}`,
          borderRadius: 7,
          color: T.text,
          fontSize: 12,
          outline: "none",
          fontFamily: "Inter,sans-serif",
          transition: "border-color 100ms",
        }}
      />
    </div>
  );
}

// ─── Select ───────────────────────────────────────────────────────────────────

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 32,
        padding: "0 28px 0 10px",
        background: T.raised,
        border: `1px solid ${T.border}`,
        borderRadius: 7,
        color: T.text,
        fontSize: 12,
        outline: "none",
        cursor: "pointer",
        fontFamily: "Inter,sans-serif",
        appearance: "none",
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6' fill='none' stroke='%2350586b' stroke-width='1.5'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── FilterToggle ─────────────────────────────────────────────────────────────

export function FilterToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        background: T.raised,
        border: `1px solid ${T.border}`,
        borderRadius: 7,
        overflow: "hidden",
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: "0 12px",
            height: 32,
            background: value === o.value ? T.active : "none",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            color: value === o.value ? T.text : T.textDim,
            fontFamily: "Inter,sans-serif",
            transition: "background 100ms, color 100ms",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  sub,
  action,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "64px 24px",
        textAlign: "center",
      }}
    >
      <span
        style={{ color: T.borderStrong, display: "block", marginBottom: 14 }}
      >
        {icon}
      </span>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: T.textSub,
          marginBottom: 5,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 12,
          color: T.textDim,
          maxWidth: 280,
          lineHeight: 1.6,
          marginBottom: action ? 16 : 0,
        }}
      >
        {sub}
      </div>
      {action}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

export function Skeleton({
  h = 14,
  w = "100%",
  r = 4,
}: {
  h?: number;
  w?: number | string;
  r?: number;
}) {
  return (
    <div
      style={{
        height: h,
        width: w,
        borderRadius: r,
        background: T.border,
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}

// ─── ErrorState ───────────────────────────────────────────────────────────────

export function ErrorState({
  title,
  sub,
  onRetry,
}: {
  title: string;
  sub: string;
  onRetry?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "64px 24px",
        textAlign: "center",
      }}
    >
      <span style={{ color: T.red, marginBottom: 14, display: "block" }}>
        <AlertTriangle size={32} />
      </span>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: T.text,
          marginBottom: 5,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 12,
          color: T.textDim,
          maxWidth: 280,
          lineHeight: 1.6,
          marginBottom: 16,
        }}
      >
        {sub}
      </div>
      {onRetry && (
        <Btn onClick={onRetry} variant="secondary">
          Retry
        </Btn>
      )}
    </div>
  );
}

// ─── ConfirmDialog ────────────────────────────────────────────────────────────

export function ConfirmDialogModal({
  dialog,
  onClose,
}: {
  dialog: ConfirmDialog;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="anim-slide-down"
        style={{
          background: T.overlay,
          border: `1px solid ${T.borderStrong}`,
          borderRadius: 12,
          padding: "24px",
          width: 400,
          maxWidth: "90vw",
          boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 16,
          }}
        >
          {dialog.danger && (
            <AlertTriangle
              size={18}
              color={T.red}
              style={{ flexShrink: 0, marginTop: 1 }}
            />
          )}
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: T.text,
                marginBottom: 5,
              }}
            >
              {dialog.title}
            </div>
            <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.6 }}>
              {dialog.message}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Btn onClick={onClose} variant="ghost">
            Cancel
          </Btn>
          <Btn
            onClick={() => {
              dialog.onConfirm();
              onClose();
            }}
            variant={dialog.danger ? "danger" : "primary"}
          >
            {dialog.action}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── ToastStack ───────────────────────────────────────────────────────────────

export function ToastStack({
  toasts,
  onRemove,
}: {
  toasts: Toast[];
  onRemove: (id: string) => void;
}) {
  const icons: Record<ToastType, ReactNode> = {
    success: <Check size={12} />,
    error: <X size={12} />,
    warning: <AlertTriangle size={12} />,
    info: <Check size={12} />,
  };
  const colors: Record<ToastType, string> = {
    success: T.green,
    error: T.red,
    warning: T.yellow,
    info: T.accent,
  };
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="anim-toast-in"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 8,
            background: T.overlay,
            border: `1px solid ${T.borderStrong}`,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            color: T.text,
            fontSize: 12,
            fontWeight: 500,
            pointerEvents: "all",
            minWidth: 240,
            maxWidth: 380,
          }}
        >
          <span
            style={{ color: colors[t.type], display: "flex", flexShrink: 0 }}
          >
            {icons[t.type]}
          </span>
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            onClick={() => onRemove(t.id)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: T.textDim,
              display: "flex",
              padding: 2,
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── QuickAction ──────────────────────────────────────────────────────────────

export function QuickAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "8px 12px",
        width: "100%",
        background: hov ? T.hover : T.bg,
        border: `1px solid ${hov ? T.borderStrong : T.border}`,
        borderRadius: 7,
        cursor: "pointer",
        textAlign: "left",
        fontSize: 12,
        fontWeight: 500,
        color: hov ? T.text : T.textSub,
        fontFamily: "Inter,sans-serif",
        transition: "all 100ms",
      }}
    >
      <span
        style={{
          color: hov ? T.textSub : T.textDim,
          display: "flex",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      <ArrowRight size={11} color={hov ? T.textDim : "transparent"} />
    </button>
  );
}
