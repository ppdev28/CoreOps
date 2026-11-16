import { request } from "../../shared/api/client";
import type {
  ApiContainer,
  ApiContainerDetail,
  ApiContainerActionResponse,
  ContainerAction,
} from "../../../../api/typescript/containers";
import type { Container, ContainerDetailData } from "./model";
import { toContainer } from "./mapper";
export type { ContainerAction } from "../../../../api/typescript/containers";

export async function getContainers(
  signal?: AbortSignal,
): Promise<Container[]> {
  const containers = await request<ApiContainer[]>("/containers", { signal });
  return containers.map(toContainer);
}

export async function getContainerDetail(
  id: string,
): Promise<ContainerDetailData> {
  const detail = await request<ApiContainerDetail>(
    `/containers/${encodeURIComponent(id)}`,
  );
  return {
    ...detail,
    config: {
      ...detail.config,
      env: detail.config.env ?? [],
      cmd: detail.config.cmd ?? [],
      entrypoint: detail.config.entrypoint ?? [],
    },
    mounts: detail.mounts ?? [],
    networks: detail.networks ?? {},
    ports: detail.ports ?? {},
    labels: detail.labels ?? {},
  };
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
    throw new Error(
      "CoreOps API returned an invalid container action response",
    );
}

export interface CreateContainerInput {
  name: string;
  image: string;
  environment: string[];
  command: string[];
  ports: {
    hostIp: string;
    hostPort: number;
    containerPort: number;
    protocol: "tcp" | "udp";
  }[];
  restartPolicy: "no" | "always" | "unless-stopped" | "on-failure";
  start: boolean;
}

export interface CreateContainerResult {
  id: string;
  name: string;
  started: boolean;
  warnings: string[];
  startError?: string;
}

export async function createContainer(
  input: CreateContainerInput,
): Promise<CreateContainerResult> {
  const result = await request<CreateContainerResult>("/containers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!result.id || result.name !== input.name)
    throw new Error(
      "Creation could not be confirmed. Refresh the container list before retrying.",
    );
  return result;
}

export async function deleteContainer(id: string): Promise<void> {
  const response = await request<ApiContainerActionResponse>(
    `/containers/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!response.ok || response.id !== id)
    throw new Error(
      "Deletion could not be confirmed. Refresh the container list before retrying.",
    );
}
