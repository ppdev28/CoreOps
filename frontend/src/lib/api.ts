import { toLifecycleStatus as mapStatus } from "../shared/ui/status";
import { ApiError, getApiBase, request } from "../shared/api/client";
export {
  getContainers,
  getContainerDetail,
  runContainerAction,
} from "../features/containers";
export type { ContainerAction } from "../features/containers";
import { getAuthToken, setSession, type AuthSession } from "./auth";
import type {
  HostOverview,
  NetworkOverview,
  StorageOverview,
  SystemService,
  SecurityOverview,
  UpdatesOverview,
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
): Promise<void> {
  try {
    const capability = await request<{ available: boolean; protocol: number }>(
      "/terminal/session",
      { signal, cache: "no-store" },
    );
    if (capability.available !== true || capability.protocol !== 1)
      throw new Error(
        "The API returned an incompatible terminal protocol. Update and restart the CoreOps backend.",
      );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404)
      throw new Error(
        "This API does not support interactive terminals. Rebuild and restart the CoreOps backend.",
      );
    throw error;
  }
}

// Authenticate inside the connection, never in a URL or browser history.
export function openTerminalSession(cols: number, rows: number): WebSocket {
  const url = new URL(`${getApiBase()}/terminal/session`, window.location.href);
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
export async function getApplications(): Promise<AppService[]> {
  const applications = await request<ApiApplication[]>("/applications");
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
export async function getLogs(): Promise<{
  entries: Array<{
    timestamp: string;
    level: string;
    source: string;
    message: string;
  }>;
  sources: string[];
  updatedAt: string;
}> {
  return request("/logs");
}
export async function getSecurity(): Promise<SecurityOverview> {
  return request("/security");
}
export async function terminateSecuritySession(pid: number): Promise<void> {
  const response = await request<{ ok: boolean; pid: number }>(
    `/security/sessions/${pid}/terminate`,
    { method: "POST" },
  );
  if (!response.ok || response.pid !== pid)
    throw new Error("CoreOps API returned an invalid session response");
}
export async function fixSecurityItem(item: "auto-updates"): Promise<void> {
  const response = await request<{ ok: boolean; item: string }>(
    `/security/fix/${item}`,
    { method: "POST" },
  );
  if (!response.ok || response.item !== item)
    throw new Error("CoreOps API returned an invalid security fix response");
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
export async function refreshUpdates(): Promise<UpdatesOverview> {
  return request("/updates/refresh", { method: "POST" });
}
export async function applyUpdates(
  packages: string[],
  all = false,
): Promise<ApplyUpdatesResponse> {
  return request("/updates/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packages, all }),
  });
}
