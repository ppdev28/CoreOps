import type { ContainerStatus, HealthStatus } from "./types";
import "../styles/sidebar.css";
import { loadWebSettings } from "./webSettings";

const DARK = {
  bg: "#1c1e25",
  bgSidebar: "rgb(6,6,6)",
  bgHeader: "rgb(13, 19, 32)",
  raised: "rgb(7, 7, 8)",
  overlay: "#171a21",
  hover: "#1a1d26",
  active: "#1f2330",
  border: "rgb(38, 44, 59)",
  borderRight: "rgb(102, 133, 175)",
  borderMuted: "#181b27",
  borderStrong: "#2d3348",
  text: "#eaecf0",
  textSub: "#8b92a5",
  textDim: "#50586b",
  accent: "#3b82f6",
  accentHover: "#2563eb",
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
  purple: "#a78bfa",
};

const LIGHT = {
  bg: "#f1f3f8",
  bgSidebar: "#ffffff",
  bgHeader: "#ffffff",
  raised: "#ffffff",
  overlay: "#f8fafc",
  hover: "#e8edf5",
  active: "#e2eaf8",
  border: "#d6dce7",
  borderRight: "#b8c7de",
  borderMuted: "#e7ebf2",
  borderStrong: "#b7c2d4",
  text: "#172033",
  textSub: "#4b5870",
  textDim: "#748198",
  accent: "#2563eb",
  accentHover: "#1d4ed8",
  green: "#16a34a",
  yellow: "#d97706",
  red: "#dc2626",
  purple: "#7c3aed",
};

function palette() {
  const settings = loadWebSettings();
  if (settings.theme === "light") return LIGHT;
  if (
    settings.theme === "system" &&
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return LIGHT;
  }
  return DARK;
}

export const T = {
  get bg() {
    return palette().bg;
  },
  get bgSidebar() {
    return palette().bgSidebar;
  },
  get bgHeader() {
    return palette().bgHeader;
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
  get accentHover() {
    return palette().accentHover;
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

export const STATUS_MAP: Record<
  ContainerStatus,
  { color: string; bg: string; label: string; pulse?: boolean }
> = {
  running: {
    color: "#22c55e",
    bg: "rgba(34,197,94,0.1)",
    label: "Running",
    pulse: true,
  },
  stopped: {
    color: "#64748b",
    bg: "rgba(100,116,139,0.1)",
    label: "Stopped",
  },
  paused: {
    color: "#d97706",
    bg: "rgba(217,119,6,0.1)",
    label: "Paused",
  },
  restarting: {
    color: "#d97706",
    bg: "rgba(217,119,6,0.1)",
    label: "Restarting",
    pulse: true,
  },
  exited: {
    color: "#dc2626",
    bg: "rgba(220,38,38,0.1)",
    label: "Exited",
  },
};

export const HEALTH_MAP: Record<
  HealthStatus,
  { color: string; label: string }
> = {
  healthy: { color: "#22c55e", label: "Healthy" },
  unhealthy: { color: "#ef4444", label: "Unhealthy" },
  starting: { color: "#f59e0b", label: "Starting" },
  none: { color: "#64748b", label: "No healthcheck" },
};
