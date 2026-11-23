import { toLifecycleStatus as mapStatus } from "../shared/ui/status";
import { ApiError, getApiBase, request } from "../shared/api/client";
export { getApiBase, request } from "../shared/api/client";
export {
  getContainers,
  getContainerDetail,
  runContainerAction,
  createContainer,
  deleteContainer,
} from "../features/containers";
export type {
  ContainerAction,
  CreateContainerInput,
  CreateContainerResult,
} from "../features/containers";
import { getAuthToken, setSession, type AuthSession } from "./auth";
import type {
  LogsOverview,
  HostLogCatalog,
  HostOverview,
  NetworkOverview,
  StorageOverview,
  SystemService,
  SecurityOverview,
  SecuritySession,
  UpdatesOverview,
  UpdateJob,
  AppService,
  VirtualMachine,
} from "./types";
import type { MonitoringOverview } from "./monitoring";
type ApiApplication = {
  id: string;
  name: string;
  description: string;
  status: string;
  containers: number;
  version: string;
  category: string;
  icon: string;
  containerIds?: string[];
};
type ApiService = SystemService;
type ApiServiceActionResponse = { ok: boolean; name: string; action: string };
type ApiApplicationActionResponse = { ok: boolean; id: string; action: string };
type ApiVirtualMachineActionResponse = {
  ok: boolean;
  name: string;
  action: string;
};
export type ServiceAction = "start" | "stop" | "restart";
export type ApplicationAction = "start" | "stop" | "restart";
export type VirtualMachineAction = "start" | "shutdown";
export interface ApplyUpdatesResponse {
  ok: boolean;
  packages: string[];
  output: string;
}
export async function checkTerminalAvailability(
  signal?: AbortSignal,
  containerId?: string,
): Promise<void> {
  try {
    const capability = await request<{ available: boolean; protocol: number }>(
      terminalEndpoint(containerId),
      { signal, cache: "no-store" },
    );
    if (capability.available !== true || capability.protocol !== 1)
      throw new Error(
        "The API returned an incompatible terminal protocol. Update and restart the CoreOps backend.",
      );
  } catch (error) {
    if (!containerId && error instanceof ApiError && error.status === 404)
      throw new Error(
        "This API does not support interactive terminals. Rebuild and restart the CoreOps backend.",
      );
    throw error;
  }
}

// Authenticate inside the connection, never in a URL or browser history.
function terminalEndpoint(containerId?: string): string {
  return containerId
    ? `/containers/${encodeURIComponent(containerId)}/terminal`
    : "/terminal/session";
}
export function openTerminalSession(
  cols: number,
  rows: number,
  containerId?: string,
): WebSocket {
  const url = new URL(
    `${getApiBase()}${terminalEndpoint(containerId)}`,
    window.location.href,
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  let token = getAuthToken();
  socket.addEventListener(
    "open",
    () => {
      socket.send(JSON.stringify({ type: "auth", token, cols, rows }));
      token = null;
    },
    { once: true },
  );
  return socket;
}
function toApplication(app: ApiApplication): AppService {
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    status: mapStatus(app.status),
    containers: app.containers,
    version: app.version,
    category: app.category,
    icon: app.icon,
    containerIds: app.containerIds,
  };
}
export async function login(
  username: string,
  password: string,
): Promise<AuthSession> {
  const session = await request<AuthSession>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  setSession(session);
  return session;
}
export async function logout(): Promise<void> {
  try {
    await request("/auth/logout", { method: "POST" });
  } catch {
    // The local session is dropped regardless of the server response.
  }
  setSession(null);
}
export async function getHost(): Promise<HostOverview> {
  return request("/host");
}
export interface ComposeInput {
  project: string;
  compose: string;
  start: boolean;
  validationHash?: string;
}
export interface ComposePreview {
  project: string;
  hash: string;
  services: { name: string; image: string; ports: string[] }[];
  volumes: string[];
  warnings: string[];
}
export interface ComposeResult {
  project: string;
  state: "created" | "started" | "partial";
  containers: { id: string; name: string; service: string; status: string }[];
  warnings: string[];
  operationError?: string;
}
export async function getComposeCapabilities(
  signal?: AbortSignal,
): Promise<{ available: boolean; version: string; reason: string }> {
  try {
    const result = await request<{
      available: boolean;
      version: string;
      reason: string;
    }>("/compose", { signal });
    if (
      typeof result.available !== "boolean" ||
      typeof result.reason !== "string"
    )
      throw new Error(
        "The API returned invalid Compose capabilities. Update and restart the CoreOps backend.",
      );
    return result;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404)
      throw new Error(
        "This API does not support Compose creation. Rebuild and restart the CoreOps backend, then retry.",
      );
    throw cause;
  }
}
export async function validateCompose(
  input: ComposeInput,
): Promise<ComposePreview> {
  const result = await request<ComposePreview>("/compose/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (
    result.project !== input.project ||
    !result.hash ||
    !Array.isArray(result.services) ||
    !result.services.length
  )
    throw new Error(
      "Compose validation returned an invalid response. Update the CoreOps API.",
    );
  return result;
}
export async function createComposeProject(
  input: ComposeInput,
): Promise<ComposeResult> {
  const result = await request<ComposeResult>("/compose/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (
    result.project !== input.project ||
    !["created", "started", "partial"].includes(result.state) ||
    !Array.isArray(result.containers)
  )
    throw new Error(
      "Compose creation could not be confirmed. Refresh the container list before retrying.",
    );
  return result;
}

export async function getApplications(
  signal?: AbortSignal,
): Promise<AppService[]> {
  const applications = await request<ApiApplication[]>("/applications", {
    signal,
  });
  return applications.map(toApplication);
}
export async function runApplicationAction(
  id: string,
  action: ApplicationAction,
): Promise<void> {
  const response = await request<ApiApplicationActionResponse>(
    `/applications/${encodeURIComponent(id)}/${action}`,
    { method: "POST" },
  );
  if (!response.ok || response.id !== id || response.action !== action)
    throw new Error(
      "CoreOps API returned an invalid application action response",
    );
}
export async function getServices(): Promise<SystemService[]> {
  return request("/services");
}
export async function runServiceAction(
  name: string,
  action: ServiceAction,
): Promise<void> {
  const response = await request<ApiServiceActionResponse>(
    `/services/${encodeURIComponent(name)}/${action}`,
    { method: "POST" },
  );
  if (!response.ok || response.name !== name || response.action !== action)
    throw new Error("CoreOps API returned an invalid service action response");
}
export async function getStorage(): Promise<StorageOverview> {
  return request("/storage");
}
export async function getNetwork(): Promise<NetworkOverview> {
  return request("/network");
}
export async function getMonitoring(): Promise<MonitoringOverview> {
  return request("/monitoring");
}
export async function getHostLogSources(
  signal?: AbortSignal,
): Promise<HostLogCatalog> {
  const result = await request<HostLogCatalog>("/logs/sources", { signal });
  if (!Array.isArray(result.files) || !Array.isArray(result.warnings))
    throw new Error("Update and restart the API to discover host log files.");
  return result;
}
export async function getLogs(
  options: {
    containerId?: string;
    system?: boolean;
    events?: boolean;
    filePath?: string;
    category?: string;
    cursor?: string;
    since?: string;
    until?: string;
    unit?: string;
    tail?: number;
    signal?: AbortSignal;
  } = {},
): Promise<LogsOverview> {
  const params = new URLSearchParams();
  let path = "/logs";
  if (options.containerId) {
    path = `/containers/${encodeURIComponent(options.containerId)}/logs`;
    params.set("tail", String(options.tail ?? 500));
  } else if (options.system || options.events || options.filePath) {
    params.set(
      "source",
      options.system ? "system" : options.events ? "events" : "file",
    );
    if (options.filePath) params.set("file", options.filePath);
    if (options.tail) params.set("limit", String(options.tail));
    for (const key of [
      "category",
      "cursor",
      "since",
      "until",
      "unit",
    ] as const) {
      if (options[key]) params.set(key, options[key]);
    }
  }
  return request(`${path}${params.size ? `?${params}` : ""}`, {
    signal: options.signal,
  });
}
export async function getSecurity(
  signal?: AbortSignal,
): Promise<SecurityOverview> {
  return request("/security", { signal });
}
export async function terminateSecuritySession(
  session: SecuritySession,
): Promise<void> {
  const response = await request<{
    ok: boolean;
    pid: number;
    id: string;
    status: string;
  }>(`/security/sessions/${session.pid}/terminate`, {
    method: "POST",
    body: JSON.stringify({ id: session.id }),
  });
  if (
    !response.ok ||
    response.pid !== session.pid ||
    response.id !== session.id ||
    response.status !== "termination_requested"
  )
    throw new Error("CoreOps API returned an invalid session response");
}
export async function fixSecurityItem(item: "auto-updates"): Promise<void> {
  const response = await request<{
    ok: boolean;
    item: string;
    verified: boolean;
  }>(`/security/fix/${item}`, { method: "POST" });
  if (!response.ok || response.item !== item || response.verified !== true)
    throw new Error("CoreOps API could not verify the security fix");
}
export async function getVirtualMachines(): Promise<VirtualMachine[]> {
  return request("/virtual-machines");
}
export async function runVirtualMachineAction(
  name: string,
  action: VirtualMachineAction,
): Promise<void> {
  const response = await request<ApiVirtualMachineActionResponse>(
    `/virtual-machines/${encodeURIComponent(name)}/${action}`,
    { method: "POST" },
  );
  if (!response.ok || response.name !== name || response.action !== action)
    throw new Error(
      "CoreOps API returned an invalid virtual machine action response",
    );
}
export async function getUpdates(): Promise<UpdatesOverview> {
  return request("/updates");
}
export async function refreshUpdates(): Promise<UpdateJob> {
  return request("/updates/refresh", { method: "POST" });
}
export async function applyUpdates(
  packages: string[],
  all = false,
): Promise<UpdateJob> {
  return request("/updates/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packages, all }),
  });
}

export function getUpdateJob(
  id = "current",
  signal?: AbortSignal,
): Promise<UpdateJob | null> {
  return request(`/updates/jobs/${encodeURIComponent(id)}`, { signal });
}
