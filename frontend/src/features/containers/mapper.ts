import { toLifecycleStatus as mapStatus } from "../../shared/ui/status";
import type {
  ApiPort,
  ApiContainer,
} from "../../../../api/typescript/containers";
import type { Container } from "./model";
import type { ContainerStatus, HealthStatus } from "../../shared/ui/status";

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
export function toContainer(container: ApiContainer): Container {
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
    restarts: null,
    networkMode: container.networks?.[0] || "—",
    ip: "—",
    mac: "—",
  };
}
