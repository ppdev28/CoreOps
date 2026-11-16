import { getAuthToken, getServerUrl, setSession } from "../platform/session";

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(
  /\/+$/,
  "",
);
// Vite proxies /api to the Go backend in the browser. Capacitor has no Vite
// proxy, so native builds (and anyone pointing the UI at another server) use the
// server address saved on the login screen. VITE_API_BASE_URL overrides both.
export function getApiBase(): string {
  if (configuredApiBase) return configuredApiBase;
  const server = getServerUrl();
  return server ? `${server}/api/v1` : "/api/v1";
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const apiBase = getApiBase();
  const url = `${apiBase}${path}`;
  let response: Response;

  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  try {
    response = await fetch(url, { ...init, headers });
  } catch (error) {
    throw new Error(
      `Unable to reach the CoreOps API at ${apiBase}. Check the server address and network connection.`,
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const bodyText = await response.text();

  if (response.status === 401 && token) {
    // The session expired or was revoked; send the user back to the login screen.
    setSession(null);
  }

  if (!response.ok) {
    let body: { error?: string } | null = null;
    try {
      body = JSON.parse(bodyText) as { error?: string };
    } catch {
      // Keep the HTTP status when the server returned HTML or another non-JSON body.
    }
    throw new ApiError(
      response.status,
      body?.error ||
        `CoreOps API returned ${response.status} (${contentType || "unknown content type"})`,
    );
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(
      `CoreOps API returned a non-JSON response from ${url}. Check the API base URL; the server returned ${contentType || "unknown content type"}.`,
    );
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new Error(`CoreOps API returned invalid JSON from ${url}`);
  }
}
