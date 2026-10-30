export type Role = "viewer" | "operator" | "admin";

export interface AuthUser {
  name: string;
  role: Role;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

const STORAGE_KEY = "coreops.session";
const listeners = new Set<() => void>();
let memorySession: AuthSession | null | undefined;

function readStored(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

// The session lives in localStorage so it survives reloads; if storage is
// unavailable it only lasts for the current page.
export function getSession(): AuthSession | null {
  if (memorySession === undefined) memorySession = readStored();
  if (memorySession && Date.parse(memorySession.expiresAt) <= Date.now()) {
    setSession(null);
  }
  return memorySession ?? null;
}

export function setSession(session: AuthSession | null) {
  memorySession = session;
  try {
    if (session)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Keep working with the in-memory copy.
  }
  listeners.forEach((listener) => listener());
}

export function getAuthToken(): string | null {
  return getSession()?.token ?? null;
}

export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_KEY = "coreops.serverUrl";

// Address of the CoreOps API (for example http://100.x.y.z:8082). Empty means
// same-origin, which is what the browser build behind the Vite proxy uses.
export function getServerUrl(): string {
  try {
    return window.localStorage.getItem(SERVER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function normalizeServerUrl(input: string): string | null {
  const value = input.trim().replace(/\/+$/, "");
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return null;
  }
}

export function setServerUrl(url: string) {
  try {
    if (url) window.localStorage.setItem(SERVER_KEY, url);
    else window.localStorage.removeItem(SERVER_KEY);
  } catch {
    // Not persisted; the address has to be entered again next time.
  }
}

const LAN_KEY = "coreops.lanUrl";
const LAN_PROBE_MS = 1500;
let activeServer: string | null = null;

// Optional address reachable only from the home network. When it answers
// /health quickly it is preferred over the main (for example Tailscale) one.
export function getLanUrl(): string {
  try {
    return window.localStorage.getItem(LAN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setLanUrl(url: string) {
  try {
    if (url) window.localStorage.setItem(LAN_KEY, url);
    else window.localStorage.removeItem(LAN_KEY);
  } catch {
    // Not persisted; the address has to be entered again next time.
  }
  activeServer = null;
}

// Address the API client should use right now: the LAN one if the last probe
// succeeded, otherwise the main one.
export function getActiveServerUrl(): string {
  return activeServer ?? getServerUrl();
}

export async function resolveServerUrl(): Promise<string> {
  const lan = getLanUrl();
  activeServer = null;
  if (lan) {
    try {
      const res = await fetch(`${lan}/api/v1/health`, {
        signal: AbortSignal.timeout(LAN_PROBE_MS),
      });
      if (res.ok) activeServer = lan;
    } catch {
      // Not on the home network; fall back to the main address.
    }
  }
  return getActiveServerUrl();
}
