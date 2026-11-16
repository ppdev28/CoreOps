import type { ContainerStatus, HealthStatus } from "../../shared/ui/status";

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
  restarts: number | null;
  networkMode: string;
  ip: string;
  mac: string;
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
  networks: Record<
    string,
    {
      IPAddress?: string;
      MacAddress?: string;
      Gateway?: string;
      NetworkID?: string;
    }
  >;
  ports: Record<
    string,
    Array<{
      HostIp?: string;
      HostPort?: string;
    }> | null
  >;
  labels: Record<string, string>;
}
