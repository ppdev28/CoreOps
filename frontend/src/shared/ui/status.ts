export type ContainerStatus =
  | "running"
  | "stopped"
  | "paused"
  | "restarting"
  | "exited";
export type HealthStatus = "healthy" | "unhealthy" | "starting" | "none";

export function toLifecycleStatus(state: string): ContainerStatus {
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
