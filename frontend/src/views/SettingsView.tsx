import { useEffect, useState } from "react";
import { T } from "../lib/tokens";
import { Card, CardHeader, Btn } from "../components/ui";
import {
  Check,
  RotateCcw,
  Monitor,
  Bell,
  Keyboard,
  ShieldCheck,
  Database,
  Gauge,
} from "lucide-react";
import {
  DEFAULT_WEB_SETTINGS,
  loadWebSettings,
  resetWebSettings,
  saveWebSettings,
  type ThemePreference,
  type WebSettings,
} from "../lib/webSettings";

const SECTIONS = [
  {
    id: "General",
    icon: <Gauge size={14} />,
    description: "Interface and behavior",
  },
  {
    id: "Appearance",
    icon: <Monitor size={14} />,
    description: "Theme and visual preferences",
  },
  {
    id: "Notifications",
    icon: <Bell size={14} />,
    description: "Alerts and feedback",
  },
  {
    id: "Keyboard",
    icon: <Keyboard size={14} />,
    description: "Shortcuts and navigation",
  },
  {
    id: "Security",
    icon: <ShieldCheck size={14} />,
    description: "Confirmation safeguards",
  },
  {
    id: "Data",
    icon: <Database size={14} />,
    description: "Local browser data",
  },
];

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        position: "relative",
        cursor: "pointer",
        border: "none",
        background: checked ? T.accent : T.overlay,
        transition: "background 180ms",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 19 : 3,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 160ms",
        }}
      />
    </button>
  );
}
function SettingRow({
  label,
  sub,
  children,
}: {
  label: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        padding: "14px 18px",
        borderBottom: `1px solid ${T.borderMuted}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 11,
            color: T.textDim,
            marginTop: 3,
            lineHeight: 1.45,
          }}
        >
          {sub}
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}
function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 32,
        minWidth: 130,
        padding: "0 9px",
        background: T.raised,
        border: `1px solid ${T.border}`,
        borderRadius: 7,
        color: T.text,
        fontSize: 11,
        outline: "none",
        fontFamily: "Inter,sans-serif",
      }}
    >
      {children}
    </select>
  );
}

export default function SettingsView({
  addToast,
}: {
  addToast: (m: string, t: any) => void;
}) {
  const [active, setActive] = useState("General");
  const [settings, setSettings] = useState<WebSettings>(loadWebSettings);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    document.documentElement.dataset.scpReduceMotion = settings.reduceMotion
      ? "true"
      : "false";
    document.documentElement.dataset.scpCompact = settings.compact
      ? "true"
      : "false";
  }, [settings.reduceMotion, settings.compact]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset.scpReduceMotion;
      delete document.documentElement.dataset.scpCompact;
    },
    [],
  );
  const patch = (next: Partial<WebSettings>) => {
    setSettings((s) => ({ ...s, ...next }));
    setSaved(false);
  };
  const save = () => {
    const previous = loadWebSettings();
    saveWebSettings(settings);
    setSaved(true);
    addToast("Web app settings saved", "success");
    if (previous.theme !== settings.theme) window.location.reload();
  };
  const reset = () => {
    setSettings(DEFAULT_WEB_SETTINGS);
    resetWebSettings();
    setSaved(true);
    addToast("Web app settings reset", "success");
    window.location.reload();
  };

  const renderSection = () => {
    if (active === "General")
      return (
        <Card>
          <SettingRow
            label="Compact interface"
            sub="Reduce spacing in tables, lists and navigation."
          >
            <Toggle
              checked={settings.compact}
              onChange={(v) => patch({ compact: v })}
            />
          </SettingRow>
          <SettingRow
            label="Automatic refresh"
            sub="Allow live views to refresh their server data automatically."
          >
            <Toggle
              checked={settings.autoRefresh}
              onChange={(v) => patch({ autoRefresh: v })}
            />
          </SettingRow>
          <SettingRow
            label="Refresh interval"
            sub="Preferred interval for views that support automatic refresh."
          >
            <Select
              value={String(settings.refreshSeconds)}
              onChange={(v) => patch({ refreshSeconds: Number(v) })}
            >
              <option value="5">5 seconds</option>
              <option value="10">10 seconds</option>
              <option value="30">30 seconds</option>
              <option value="60">1 minute</option>
            </Select>
          </SettingRow>
        </Card>
      );
    if (active === "Appearance")
      return (
        <Card>
          <SettingRow
            label="Theme"
            sub="Choose a dark, light, or operating-system controlled appearance."
          >
            <Select
              value={settings.theme}
              onChange={(v) => patch({ theme: v as ThemePreference })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </Select>
          </SettingRow>
          <SettingRow
            label="Reduce motion"
            sub="Disable non-essential transitions and animated interface effects."
          >
            <Toggle
              checked={settings.reduceMotion}
              onChange={(v) => patch({ reduceMotion: v })}
            />
          </SettingRow>
          <SettingRow
            label="Interface density"
            sub="Choose between the standard and compact control-panel layout."
          >
            <Select
              value={settings.compact ? "compact" : "comfortable"}
              onChange={(v) => patch({ compact: v === "compact" })}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </Select>
          </SettingRow>
        </Card>
      );
    if (active === "Notifications")
      return (
        <Card>
          <SettingRow
            label="In-app notifications"
            sub="Show toast messages when actions complete or fail."
          >
            <Toggle
              checked={settings.notifications}
              onChange={(v) => patch({ notifications: v })}
            />
          </SettingRow>
          <SettingRow
            label="Notification sound"
            sub="Play a subtle sound for important notifications."
          >
            <Toggle
              checked={settings.sound}
              onChange={(v) => patch({ sound: v })}
            />
          </SettingRow>
        </Card>
      );
    if (active === "Keyboard")
      return (
        <Card>
          <SettingRow
            label="Keyboard shortcuts"
            sub="Enable shortcuts such as ⌘ K for the command palette."
          >
            <Toggle
              checked={settings.shortcuts}
              onChange={(v) => patch({ shortcuts: v })}
            />
          </SettingRow>
          <SettingRow
            label="Command palette"
            sub="Use ⌘ K on macOS or Ctrl K on Linux/Windows to navigate quickly."
          >
            <span
              style={{
                fontSize: 11,
                color: T.textSub,
                fontFamily: "JetBrains Mono,monospace",
                padding: "5px 8px",
                background: T.bg,
                border: `1px solid ${T.border}`,
                borderRadius: 5,
              }}
            >
              ⌘ K / Ctrl K
            </span>
          </SettingRow>
        </Card>
      );
    if (active === "Security")
      return (
        <Card>
          <SettingRow
            label="Confirm destructive actions"
            sub="Ask for confirmation before stopping, removing or terminating resources."
          >
            <Toggle
              checked={settings.confirmDestructive}
              onChange={(v) => patch({ confirmDestructive: v })}
            />
          </SettingRow>
          <div
            style={{
              padding: "14px 18px",
              fontSize: 11,
              color: T.textDim,
              lineHeight: 1.55,
            }}
          >
            This preference only affects the web interface. Server-side
            permissions and authentication remain unchanged.
          </div>
        </Card>
      );
    return (
      <Card>
        <CardHeader title="Browser data" />
        <div style={{ padding: "16px 18px" }}>
          <div
            style={{
              fontSize: 12,
              color: T.textSub,
              lineHeight: 1.55,
              marginBottom: 14,
            }}
          >
            CoreOps stores interface preferences locally in this browser. Server
            configuration, credentials and terminal data are not stored here.
          </div>
          <Btn variant="danger" size="xs" onClick={reset}>
            <RotateCcw size={11} /> Reset local settings
          </Btn>
        </div>
      </Card>
    );
  };

  return (
    <div
      style={{ padding: "22px 24px", display: "flex", gap: 24, maxWidth: 980 }}
    >
      <div style={{ width: 205, flexShrink: 0 }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
            Settings
          </div>
          <div style={{ fontSize: 11, color: T.textDim, marginTop: 3 }}>
            Server Control web app
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => setActive(section.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "9px 10px",
                borderRadius: 8,
                textAlign: "left",
                background: active === section.id ? T.active : "transparent",
                border: "none",
                cursor: "pointer",
                color: active === section.id ? T.text : T.textSub,
                fontFamily: "Inter,sans-serif",
              }}
            >
              <span
                style={{
                  display: "flex",
                  color: active === section.id ? T.accent : T.textDim,
                }}
              >
                {section.icon}
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: active === section.id ? 600 : 500,
                  }}
                >
                  {section.id}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 10,
                    color: T.textDim,
                    marginTop: 2,
                  }}
                >
                  {section.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: T.text,
                letterSpacing: "-.01em",
              }}
            >
              {active}
            </h2>
            <div style={{ fontSize: 11, color: T.textDim, marginTop: 3 }}>
              Configure how Server Control behaves in this browser.
            </div>
          </div>
          <div style={{ display: "flex", gap: 7 }}>
            <Btn variant="secondary" size="xs" onClick={reset}>
              <RotateCcw size={11} /> Reset
            </Btn>
            <Btn variant="primary" size="xs" onClick={save} disabled={saved}>
              {saved ? <Check size={11} /> : null}
              {saved ? "Saved" : "Save changes"}
            </Btn>
          </div>
        </div>
        {renderSection()}
      </div>
    </div>
  );
}
