// CoreOps v1 wire types. Keep in sync with ../openapi.json and HTTP contract tests.
export type ApiPort = {
  privatePort: number;
  publicPort?: number;
  type: string;
  ip?: string;
};
export type ApiContainer = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: number;
  ports: ApiPort[];
  networks: string[];
};
export type ContainerAction = "start" | "stop" | "restart";
export type ApiContainerActionResponse = { ok: boolean; id: string };
export interface ApiContainerDetail {
  id: string;
  name: string;
  image: string;
  state: string;
  created: string;
  config: {
    env: string[] | null;
    cmd: string[] | null;
    entrypoint: string[] | null;
    workingDir: string;
  };
  restartPolicy: string;
  mounts: Array<{
    Type: string;
    Source: string;
    Destination: string;
    Mode: string;
    RW: boolean;
  }> | null;
  networks: Record<
    string,
    {
      IPAddress?: string;
      MacAddress?: string;
      Gateway?: string;
      NetworkID?: string;
    }
  > | null;
  ports: Record<
    string,
    Array<{
      HostIp?: string;
      HostPort?: string;
    }> | null
  > | null;
  labels: Record<string, string> | null;
}
