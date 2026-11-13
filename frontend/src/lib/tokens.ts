import type { ContainerStatus, HealthStatus } from "./types";
import "../styles/sidebar.css";
import { loadWebSettings, subscribeWebSettings } from "./webSettings";

import { resolveAppearance } from "./appearance";

function resolvedTheme() {
  const theme = loadWebSettings().theme;
  return theme === "system"
    ? typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark"
    : theme;
}
let activePalette = resolveAppearance(
  resolvedTheme(),
  loadWebSettings().accentColor,
);
function palette() {
  return activePalette;
}
function applyTheme() {
  const settings = loadWebSettings();
  const theme = resolvedTheme();
  activePalette = resolveAppearance(theme, settings.accentColor);
  const root = document.documentElement;
  root.dataset.coreopsReduceMotion = String(settings.reduceMotion);
  root.dataset.coreopsCompact = String(settings.compact);
  root.dataset.coreopsTheme = theme;
  root.dataset.coreopsAccent = settings.accentColor;
  root.style.colorScheme = theme === "light" ? "light" : "dark";
  root.style.setProperty("--coreops-shadow", "transparent");
  root.style.setProperty("--coreops-highlight", "transparent");
  for (const [name, value] of Object.entries(activePalette))
    root.style.setProperty(`--coreops-${name}`, value);
  window.dispatchEvent(
    new CustomEvent("coreops-theme-applied", {
      detail: { theme, accentColor: settings.accentColor },
    }),
  );
}
if (typeof document !== "undefined") {
  applyTheme();
  subscribeWebSettings(applyTheme);
}

export const T = {
  get bg() {
    return palette().bg;
  },
  get bgHeader() {
    return palette().bgHeader;
  },
  get bgSidebar() {
    return palette().bgSidebar;
  },
  get raised() {
    return palette().raised;
  },
  get overlay() {
    return palette().overlay;
  },
  get hover() {
    return palette().hover;
  },
  get active() {
    return palette().active;
  },
  get border() {
    return palette().border;
  },
  get borderHeader() {
    return palette().borderHeader;
  },
  get borderRight() {
    return palette().borderRight;
  },
  get borderMuted() {
    return palette().borderMuted;
  },
  get borderStrong() {
    return palette().borderStrong;
  },
  get text() {
    return palette().text;
  },
  get textSub() {
    return palette().textSub;
  },
  get textDim() {
    return palette().textDim;
  },
  get accent() {
    return palette().accent;
  },
  get primary() {
    return palette().primary;
  },
  get accentHover() {
    return palette().accentHover;
  },
  get onAccent() {
    return palette().onAccent;
  },
  get green() {
    return palette().green;
  },
  get yellow() {
    return palette().yellow;
  },
  get red() {
    return palette().red;
  },
  get purple() {
    return palette().purple;
  },
} as const;

function status(
  label: string,
  tone: "green" | "yellow" | "red" | "textDim",
  pulse = false,
) {
  return {
    label,
    pulse,
    get color() {
      return T[tone];
    },
    get bg() {
      return `${T[tone]}14`;
    },
  };
}
export const STATUS_MAP: Record<
  ContainerStatus,
  { color: string; bg: string; label: string; pulse?: boolean }
> = {
  running: status("Running", "green"),
  stopped: status("Stopped", "textDim"),
  paused: status("Paused", "yellow"),
  restarting: status("Restarting", "yellow"),
  exited: status("Exited", "red"),
};
export const HEALTH_MAP: Record<
  HealthStatus,
  { color: string; label: string }
> = {
  healthy: status("Healthy", "green"),
  unhealthy: status("Unhealthy", "red"),
  starting: status("Starting", "yellow"),
  none: status("No healthcheck", "textDim"),
};
