import {
  useState,
  useEffect,
  useCallback,
  useSyncExternalStore,
  lazy,
  Suspense,
  type ComponentType,
} from "react";
import { Capacitor } from "@capacitor/core";
import { T } from "./lib/tokens";
import { getSession, subscribeSession, type AuthUser } from "./lib/auth";
import LoginView from "./views/LoginView";
import type { View, ToastType, ConfirmDialog, Toast } from "./lib/types";
import { ToastStack, ConfirmDialogModal } from "./components/ui";
import { Sidebar, Header, CommandPalette } from "./components/shell";

// Views are loaded on demand so the first paint does not ship every screen.
const lazyView = <C extends ComponentType<any>>(
  load: () => Promise<{ default: C }>,
) => lazy(load);
const RealDashboardView = lazyView(() => import("./views/DashboardView"));
const ContainersView = lazyView(() => import("./views/ContainersView"));
const ContainerDetail = lazyView(() => import("./views/ContainerDetail"));
const HostView = lazyView(() => import("./views/HostView"));
const ApplicationsView = lazyView(() => import("./views/ApplicationsView"));
const ServicesView = lazyView(() => import("./views/ServicesView"));
const StorageView = lazyView(() => import("./views/StorageView"));
const NetworkView = lazyView(() => import("./views/NetworkView"));
const VirtualMachinesView = lazyView(
  () => import("./views/VirtualMachinesView"),
);
const MonitoringView = lazyView(() => import("./views/MonitoringView"));
const LogsView = lazyView(() => import("./views/LogsView"));
const TerminalView = lazyView(() => import("./views/TerminalView"));
const SecurityView = lazyView(() => import("./views/SecurityView"));
const UpdatesView = lazyView(() => import("./views/UpdatesView"));
const SettingsView = lazyView(() => import("./views/SettingsView"));
import { loadWebSettings, subscribeWebSettings } from "./lib/webSettings";

function AppShell({ user }: { user: AuthUser }) {
  // The Android shell owns the top bar and drawer when running inside Capacitor.
  // Keep the existing React shell for the browser/PWA so the web app is unchanged.
  const isNative = Capacitor.isNativePlatform();
  const [view, setView] = useState<View>("dashboard"),
    [collapsed, setCollapsed] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false),
    [showCmd, setShowCmd] = useState(false),
    [toasts, setToasts] = useState<Toast[]>([]),
    [confirm, setConfirm] = useState<ConfirmDialog | null>(null),
    [settings, setSettings] = useState(loadWebSettings),
    [selectedContainerId, setSelectedContainerId] = useState<string | null>(
      null,
    );
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
  const openContainerDetail = useCallback((id: string) => {
    setSelectedContainerId(id);
    setView("container-detail");
    setMobileOpen(false);
  }, []);
  useEffect(() => {
    const handleNativeNavigation = (event: Event) => {
      const view = (event as CustomEvent<{ view?: View }>).detail?.view;
      if (!view) return;
      navigate(view);
    };

    window.addEventListener("coreops-native-navigate", handleNativeNavigation);
    return () =>
      window.removeEventListener(
        "coreops-native-navigate",
        handleNativeNavigation,
      );
  }, [navigate]);
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
        {!isNative && (
          <>
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
          {!isNative && (
            <Header
              user={user}
              onCmd={() => setShowCmd(true)}
              onMenuToggle={() => setMobileOpen((v) => !v)}
            />
          )}
          <main
            className="coreops-main"
            style={{
              flex: 1,
              overflowY: view === "terminal" ? "hidden" : "auto",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              padding: view === "terminal" ? 0 : undefined,
            }}
          >
            <Suspense
              fallback={
                <div style={{ padding: 24, fontSize: 12, color: T.textDim }}>
                  Loading…
                </div>
              }
            >
              {view === "dashboard" && (
                <RealDashboardView onNavigate={navigate} addToast={addToast} />
              )}{" "}
              {view === "host" && <HostView />}{" "}
              {view === "containers" && (
                <ContainersView onDetail={openContainerDetail} {...shell} />
              )}{" "}
              {view === "container-detail" && selectedContainerId && (
                <ContainerDetail
                  containerId={selectedContainerId}
                  onBack={() => navigate("containers")}
                  {...shell}
                />
              )}{" "}
              {view === "applications" && (
                <ApplicationsView addToast={addToast} />
              )}{" "}
              {view === "services" && <ServicesView {...shell} />}{" "}
              {view === "storage" && <StorageView {...shell} />}{" "}
              {view === "network" && <NetworkView />}{" "}
              {view === "virtual-machines" && (
                <VirtualMachinesView addToast={addToast} />
              )}{" "}
              {view === "monitoring" && <MonitoringView />}{" "}
              {view === "logs" && <LogsView />}{" "}
              {view === "terminal" && <TerminalView />}{" "}
              {view === "security" && <SecurityView addToast={addToast} />}{" "}
              {view === "updates" && <UpdatesView {...shell} />}{" "}
              {view === "settings" && <SettingsView addToast={addToast} />}
            </Suspense>
          </main>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  if (!session) return <LoginView />;
  return <AppShell user={session.user} />;
}
