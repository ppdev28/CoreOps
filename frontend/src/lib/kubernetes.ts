import { request } from "../shared/api/client";

export type KubeKind =
  | "deployments"
  | "statefulsets"
  | "daemonsets"
  | "pods"
  | "nodes";
export interface KubeCluster {
  id: string;
  name: string;
  server: string;
  namespaces: string[];
}
export interface KubeConnection {
  name: string;
  server: string;
  namespaces: string[];
  ca: string;
  token: string;
  certificate: string;
  key: string;
}
export interface KubeCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
}
export interface KubeContainer {
  name: string;
  image: string;
  ready: boolean;
  restarts: number;
  state: string;
  reason: string;
  message: string;
  init: boolean;
  requests: Record<string, string>;
  limits: Record<string, string>;
}
export interface KubeResource {
  kind: KubeKind;
  name: string;
  namespace: string;
  uid: string;
  version: string;
  created: string;
  phase: string;
  ready: boolean;
  problem: boolean;
  reason: string;
  message: string;
  available: number;
  desired: number;
  updated: number;
  restarts: number;
  node: string;
  images: string[];
  conditions: KubeCondition[];
  containers: KubeContainer[];
  cpu: string;
  memory: string;
  allocatableCpu: string;
  allocatableMemory: string;
  podCount: number | null;
  owners: string[];
  generation: number;
  observedGeneration: number;
}
export interface KubeEvent {
  uid: string;
  resourceUid: string;
  resource: string;
  namespace: string;
  type: string;
  reason: string;
  message: string;
  time: string;
  count: number;
}
export interface KubeSnapshot {
  namespaces: string[];
  resources: Partial<Record<KubeKind, KubeResource[]>>;
  events: KubeEvent[];
  errors: Record<string, string>;
  metrics: {
    cpuCores: number;
    memoryBytes: number;
    nodes: number;
    time: string;
    window: string;
  } | null;
  nodeUsage: Record<string, { cpu: string; memory: string }>;
  updatedAt: string;
}
export interface KubeDetail {
  actionNote?: string;
  resource: KubeResource;
  pods: KubeResource[];
  events: KubeEvent[];
  permissions: Record<"scale" | "restart" | "logs" | "yaml", boolean>;
  errors: Record<string, string>;
}
const base = "/kubernetes";
export const kubeClusters = (signal?: AbortSignal) =>
  request<KubeCluster[]>(`${base}/clusters`, { signal, cache: "no-store" });
export const kubeConnect = (connection: KubeConnection) =>
  request<KubeCluster>(`${base}/clusters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(connection),
  });
export const kubeDisconnect = (cluster: string) =>
  request<{ ok: boolean }>(`${base}/clusters/${encodeURIComponent(cluster)}`, {
    method: "DELETE",
  });
export const kubeSnapshot = (
  cluster: string,
  namespace: string,
  signal?: AbortSignal,
) =>
  request<KubeSnapshot>(
    `${base}/${encodeURIComponent(cluster)}/snapshot?namespace=${encodeURIComponent(namespace)}`,
    { signal, cache: "no-store" },
  );
const resourcePath = (
  cluster: string,
  resource: Pick<KubeResource, "kind" | "namespace" | "name">,
) =>
  `${base}/${encodeURIComponent(cluster)}/resources/${resource.kind}/${encodeURIComponent(resource.namespace || "_")}/${encodeURIComponent(resource.name)}`;
export const kubeDetail = (
  cluster: string,
  resource: KubeResource,
  signal?: AbortSignal,
) =>
  request<KubeDetail>(resourcePath(cluster, resource), {
    signal,
    cache: "no-store",
  });
export const kubeYAML = (
  cluster: string,
  resource: KubeResource,
  signal?: AbortSignal,
) =>
  request<{ yaml: string }>(`${resourcePath(cluster, resource)}/yaml`, {
    signal,
    cache: "no-store",
  });
export const kubeLogs = (
  cluster: string,
  resource: KubeResource,
  container: string,
  previous: boolean,
  signal?: AbortSignal,
) =>
  request<{ text: string; updatedAt: string }>(
    `${resourcePath(cluster, resource)}/logs?container=${encodeURIComponent(container)}&previous=${previous}`,
    { signal, cache: "no-store" },
  );
export const kubeAction = (
  cluster: string,
  resource: KubeResource,
  action: "scale" | "restart",
  replicas?: number,
) =>
  request<{ accepted: boolean; message: string }>(
    `${base}/${encodeURIComponent(cluster)}/deployments/${encodeURIComponent(resource.namespace)}/${encodeURIComponent(resource.name)}/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: resource.uid,
        version: resource.version,
        ...(action === "scale" ? { replicas } : {}),
      }),
    },
  );
export const kubeAge = (date: string) => {
  if (!date || !Number.isFinite(Date.parse(date))) return "Unavailable";
  const seconds = Math.max(0, (Date.now() - Date.parse(date)) / 1000);
  return seconds < 60
    ? `${Math.floor(seconds)}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h`
        : `${Math.floor(seconds / 86400)}d`;
};
export const kubeState = (r: KubeResource) =>
  r.kind === "pods"
    ? r.phase === "Succeeded"
      ? "Completed"
      : r.problem
        ? r.reason || "Needs attention"
        : r.phase === "Running"
          ? r.ready
            ? "Ready"
            : "Running · Not ready"
          : r.phase || "Unknown"
    : r.kind === "nodes"
      ? r.ready
        ? r.problem
          ? "Ready · Pressure"
          : "Ready"
        : "Not ready"
      : r.ready
        ? r.desired === 0
          ? "Scaled to zero"
          : "Available"
        : "Progressing";
