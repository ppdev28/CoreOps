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

export async function getContainers(): Promise<Container[]> {
  const containers = await request<ApiContainer[]>("/containers");
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
