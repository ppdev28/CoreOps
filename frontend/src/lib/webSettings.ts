export const SETTINGS_STORAGE_KEY = "scp-web-settings";
export const SETTINGS_CHANGED_EVENT = "coreops-settings-changed";

export type ThemePreference = "dark" | "light" | "system";
export interface WebSettings {
  theme: ThemePreference;
  compact: boolean;
  reduceMotion: boolean;
  autoRefresh: boolean;
  refreshSeconds: number;
  notifications: boolean;
  sound: boolean;
  shortcuts: boolean;
  confirmDestructive: boolean;
}
export const DEFAULT_WEB_SETTINGS: WebSettings = {
  theme: "dark",
  compact: false,
  reduceMotion: false,
  autoRefresh: true,
  refreshSeconds: 5,
  notifications: true,
  sound: false,
  shortcuts: true,
  confirmDestructive: true,
};
export function loadWebSettings(): WebSettings {
  if (typeof window === "undefined") return DEFAULT_WEB_SETTINGS;
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}",
    ) as Partial<WebSettings>;
    const refreshSeconds = Number(raw.refreshSeconds);
    return {
      ...DEFAULT_WEB_SETTINGS,
      ...raw,
      theme:
        raw.theme === "light" || raw.theme === "system" || raw.theme === "dark"
          ? raw.theme
          : DEFAULT_WEB_SETTINGS.theme,
      refreshSeconds: [5, 10, 30, 60].includes(refreshSeconds)
        ? refreshSeconds
        : DEFAULT_WEB_SETTINGS.refreshSeconds,
    };
  } catch {
    return DEFAULT_WEB_SETTINGS;
  }
}
export function saveWebSettings(settings: WebSettings) {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(
    new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: settings }),
  );
}
export function resetWebSettings() {
  window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
  window.dispatchEvent(
    new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: DEFAULT_WEB_SETTINGS }),
  );
}
export function subscribeWebSettings(
  listener: (settings: WebSettings) => void,
) {
  const handler = (event: Event) =>
    listener((event as CustomEvent<WebSettings>).detail || loadWebSettings());
  window.addEventListener(SETTINGS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, handler);
}
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => {
    if (loadWebSettings().theme === "system")
      window.dispatchEvent(
        new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: loadWebSettings() }),
      );
  };
  media.addEventListener?.("change", handler);
}
