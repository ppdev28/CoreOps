import type {
  Container,
  ContainerStatus,
  HealthStatus,
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
import { Capacitor } from "@capacitor/core";

type ApiPort = {
  privatePort: number;
  publicPort?: number;
  type: string;
  ip?: string;
};
type ApiContainer = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: number;
  ports?: ApiPort[];
  networks?: string[];
};
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
type ApiContainerActionResponse = { ok: boolean; id: string };
type ApiServiceActionResponse = { ok: boolean; name: string; action: string };
type ApiApplicationActionResponse = { ok: boolean; id: string; action: string };
type ApiVirtualMachineActionResponse = {
  ok: boolean;
  name: string;
  action: string;
};
type ApiTerminalCompleteResponse = { candidates: string[] };
export type ContainerAction = "start" | "stop" | "restart";
export type ServiceAction = "start" | "stop" | "restart";
export type ApplicationAction = "start" | "stop" | "restart";
export type VirtualMachineAction = "start" | "shutdown";
export interface TerminalExecResponse {
  output: string;
  exitCode: number;
  cwd: string;
}
export interface ApplyUpdatesResponse {
  ok: boolean;
  packages: string[];
  output: string;
}
const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "");
// Vite proxies /api to the Go backend in the browser. Capacitor has no Vite
// proxy, so native builds need a direct backend address. Override this with
// VITE_API_BASE_URL for a physical device or a different server.
const apiBase =
  configuredApiBase ||
  (Capacitor.isNativePlatform()
    ? "http://100.84.193.37:8082/api/v1"
    : "/api/v1");
function mapStatus(state: string): ContainerStatus {
  switch (state.toLowerCase()) {
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "restarting":
      return "restarting";
    case "created":
    case "exited":
    case "dead":
      return "stopped";
    default:
      return "exited";
  }
}
function mapHealth(status: string): HealthStatus {
  const normalized = status.toLowerCase();
  if (normalized.includes("(healthy)")) return "healthy";
  if (normalized.includes("(unhealthy)")) return "unhealthy";
  if (normalized.includes("(health: starting)")) return "starting";
  return "none";
}
function formatPorts(ports: ApiPort[] = []) {
  const published = ports
    .filter((p) => p.publicPort !== undefined)
    .map((p) => `${p.publicPort}:${p.privatePort}`);
  return published.length ? published.join(", ") : "—";
}
function formatCreated(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}
function formatUptime(status: string, state: string) {
  if (state.toLowerCase() === "running")
    return (
      status.replace(/^Up\s+/i, "").replace(/\s+\(healthy\)$/i, "") || "Running"
    );
  return status || state;
}
function toContainer(container: ApiContainer): Container {
  return {
    id: container.id,
    name: container.name.replace(/^\//, ""),
    image: container.image,
    status: mapStatus(container.state),
    health: mapHealth(container.status),
    cpu: "—",
    cpuNum: 0,
    memory: "—",
    memNum: 0,
    memLimit: "—",
    net: container.networks?.join(", ") || "—",
    ports: formatPorts(container.ports),
    created: formatCreated(container.createdAt),
    uptime: formatUptime(container.status, container.state),
    restarts: 0,
    networkMode: container.networks?.[0] || "—",
    ip: "—",
    mac: "—",
  };
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
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBase}${path}`;
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(
      `Unable to reach the SCP API at ${apiBase}. Check the server address and network connection.`,
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const bodyText = await response.text();

  if (!response.ok) {
    let body: { error?: string } | null = null;
    try {
      body = JSON.parse(bodyText) as { error?: string };
    } catch {
      // Keep the HTTP status when the server returned HTML or another non-JSON body.
    }
    throw new Error(
      body?.error ||
        `SCP API returned ${response.status} (${contentType || "unknown content type"})`,
    );
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(
      `SCP API returned a non-JSON response from ${url}. Check the API base URL; the server returned ${contentType || "unknown content type"}.`,
    );
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new Error(`SCP API returned invalid JSON from ${url}`);
  }
}
export async function getHost(): Promise<HostOverview> {
  return request("/host");
}
export async function getContainers(): Promise<Container[]> {
  const containers = await request<ApiContainer[]>("/containers");
  return containers.map(toContainer);
}
export async function runContainerAction(
  id: string,
  action: ContainerAction,
): Promise<void> {
  const response = await request<ApiContainerActionResponse>(
    `/containers/${encodeURIComponent(id)}/${action}`,
    { method: "POST" },
  );
  if (!response.ok || response.id !== id)
    throw new Error("SCP API returned an invalid container action response");
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
    throw new Error("SCP API returned an invalid application action response");
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
    throw new Error("SCP API returned an invalid service action response");
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
    throw new Error("SCP API returned an invalid session response");
}
export async function fixSecurityItem(item: "auto-updates"): Promise<void> {
  const response = await request<{ ok: boolean; item: string }>(
    `/security/fix/${item}`,
    { method: "POST" },
  );
  if (!response.ok || response.item !== item)
    throw new Error("SCP API returned an invalid security fix response");
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
      "SCP API returned an invalid virtual machine action response",
    );
}
export async function execTerminal(
  command: string,
  cwd?: string,
): Promise<TerminalExecResponse> {
  return request("/terminal/exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, cwd }),
  });
}
export async function completeTerminal(
  input: string,
  cwd?: string,
): Promise<string[]> {
  const response = await request<ApiTerminalCompleteResponse>(
    "/terminal/complete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, cwd }),
    },
  );
  return response.candidates;
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
