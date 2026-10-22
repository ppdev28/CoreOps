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
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
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
