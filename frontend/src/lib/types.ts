export type View =
  | "dashboard"
  | "host"
  | "containers"
  | "container-detail"
  | "container-create"
  | "applications"
  | "app-detail"
  | "services"
  | "storage"
  | "network"
  | "virtual-machines"
  | "monitoring"
  | "logs"
  | "terminal"
  | "security"
  | "updates"
  | "settings";
export type ContainerStatus =
  | "running"
  | "stopped"
  | "paused"
  | "restarting"
  | "exited";
export type HealthStatus = "healthy" | "unhealthy" | "starting" | "none";
export type ToastType = "success" | "error" | "warning" | "info";
export interface Container {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  health: HealthStatus;
  cpu: string;
  cpuNum: number;
  memory: string;
  memNum: number;
  memLimit: string;
  net: string;
  ports: string;
  created: string;
  uptime: string;
  restarts: number;
  networkMode: string;
  ip: string;
  mac: string;
}
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
  timestamp: string;
  level: string;
  source: string;
  message: string;
}
export interface LogsOverview {
  entries: LogEntry[];
  sources: string[];
  updatedAt: string;
}
export interface SecurityCheck {
  label: string;
  ok: boolean | null;
  detail: string;
}
export interface SecuritySession {
  user: string;
  from: string;
  since: string;
  method: string;
  pid: number;
}
export interface FirewallRule {
  number: string;
  to: string;
  action: string;
  from: string;
  comment?: string;
}
export interface SecurityEvent {
  timestamp: string;
  type: string;
  message: string;
}
export interface SecurityOverview {
  updatedAt: string;
  checks: SecurityCheck[];
  sessions: SecuritySession[];
  firewallActive: boolean;
  firewallRules: FirewallRule[];
  firewallVersion: string;
  events: SecurityEvent[];
}
export interface UpdatePackage {
  package: string;
  current: string;
  available: string;
  type: "security" | "system";
  source?: string;
}
export interface UpdatesOverview {
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
  onConfirm: () => void;
}


export interface ContainerDetailData {
  id: string;
  name: string;
  image: string;
  state: string;
  created: string;
  config: {
    env: string[];
    cmd: string[];
    entrypoint: string[];
    workingDir: string;
  };
  restartPolicy: string;
  mounts: Array<{
    Type: string;
    Source: string;
    Destination: string;
    Mode: string;
    RW: boolean;
  }>;
  networks: Record<string, {
    IPAddress?: string;
    MacAddress?: string;
    Gateway?: string;
    NetworkID?: string;
  }>;
  ports: Record<string, Array<{
    HostIp?: string;
    HostPort?: string;
  }> | null>;
  labels: Record<string, string>;
}
