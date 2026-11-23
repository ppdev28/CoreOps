import type { ContainerStatus } from "../shared/ui/status";
export type { ContainerStatus, HealthStatus } from "../shared/ui/status";
export type { Container, ContainerDetailData } from "../features/containers";

export type View =
  | "dashboard"
  | "host"
  | "containers"
  | "kubernetes"
  | "container-detail"
  | "container-create"
  | "applications"
  | "app-detail"
  | "services"
  | "storage"
  | "files"
  | "network"
  | "virtual-machines"
  | "observability"
  | "monitoring"
  | "logs"
  | "terminal"
  | "security"
  | "updates"
  | "settings";
export type ToastType = "success" | "error" | "warning" | "info";
export interface HostOverview {
  hostname: string;
  os: { name: string; version: string; kernel: string; architecture: string };
  uptimeSeconds: number;
  load: { load1: number; load5: number; load15: number };
  cpu: { cores: number; usagePercent: number };
  memory: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
  };
  disk: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
  };
}
export interface AppService {
  id: string;
  name: string;
  description: string;
  status: ContainerStatus;
  containers: number;
  version: string;
  category: string;
  icon: string;
  containerIds?: string[];
}
export interface SystemService {
  id: string;
  name: string;
  description: string;
  status: "active" | "inactive" | "failed";
  enabled: boolean;
  cpu: string;
  memory: string;
  uptime: string;
}
export interface StorageDisk {
  device: string;
  model: string;
  capacityBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
  filesystem: string;
  mount: string;
  temperature: string;
  smart: string;
  type: string;
}
export interface StorageVolume {
  name: string;
  driver: string;
  mountpoint: string;
  sizeBytes: number;
  usedBytes: number;
}
export interface StorageOverview {
  totalCapacityBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
  disks: StorageDisk[];
  volumes: StorageVolume[];
}
export interface NetworkInterface {
  name: string;
  ip: string;
  mac: string;
  state: string;
  speed: string;
  rxBytes: number;
  txBytes: number;
}
export interface OpenPort {
  port: number;
  proto: string;
  process: string;
  container: string;
  address: string;
  state: string;
}
export interface NetworkContainer {
  name: string;
  ip: string;
}
export interface NetworkTopology {
  gateway: string;
  host: string;
  dockerBridge: string;
  containers: NetworkContainer[];
}
export interface NetworkOverview {
  interfaces: NetworkInterface[];
  ports: OpenPort[];
  topology: NetworkTopology;
}
export interface LogEntry {
  stream?: "stdout" | "stderr" | "tty" | "journal" | "file" | "event";
  timestamp: string;
  level: string;
  source: string;
  message: string;
}
export interface HostLogFile {
  path: string;
  name: string;
  readable: boolean;
  archive: boolean;
}
export interface HostLogCatalog {
  files: HostLogFile[];
  warnings: string[];
}
export interface LogsOverview {
  nextCursor?: string;
  historyOrder?: "older" | "newer";
  warnings?: string[];
  truncated?: boolean;
  entries: LogEntry[];
  sources: string[];
  updatedAt: string;
}
export interface SecurityCheck {
  id: string;
  label: string;
  ok: boolean | null;
  status: "pass" | "attention" | "unknown" | "info";
  detail: string;
}
export interface SecuritySession {
  id: string;
  user: string;
  uid: number;
  from: string;
  since: string;
  sinceSource?: string;
  method: string;
  pid: number;
  parentPid: number;
  terminal: string;
  name: string;
  loginId?: string;
  process: string;
  verified: boolean;
  canTerminate: boolean;
  terminationReason?: string;
}
export interface FirewallRule {
  number: string;
  to: string;
  action: string;
  from: string;
  comment?: string;
}
export interface SecurityEvent {
  id?: string;
  cursor?: string;
  source?: string;
  truncated?: boolean;
  timestamp: string;
  type: string;
  message: string;
}
export interface SecurityOverview {
  updatedAt: string;
  checks: SecurityCheck[];
  sessions: SecuritySession[];
  firewallActive: boolean | null;
  firewallRules: FirewallRule[];
  firewallVersion: string;
  events: SecurityEvent[];
  sources: Record<string, { state: string; detail?: string }>;
  capabilities: Record<string, { available: boolean; reason?: string }>;
}
export interface UpdatePackage {
  package: string;
  current: string;
  available: string;
  type: "security" | "system";
  source?: string;
}
export interface UpdateJob {
  id: string;
  action: "refresh" | "apply" | "upgrade";
  status: "running" | "succeeded" | "failed";
  packages: string[];
  startedAt: string;
  finishedAt?: string;
  output: string;
  error?: string;
  warning?: string;
  overview?: UpdatesOverview;
}
export interface UpdatesOverview {
  capability?: { available: boolean; error?: string };
  updatedAt: string;
  updates: UpdatePackage[];
  securityCount: number;
  systemCount: number;
}
export interface VirtualMachine {
  name: string;
  connection: string;
  state: string;
}
export type VirtualMachineAction = "start" | "shutdown";
export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}
export interface ConfirmDialog {
  title: string;
  message: string;
  action: string;
  danger?: boolean;
  requireConfirmation?: boolean;
  onConfirm: () => void;
}
