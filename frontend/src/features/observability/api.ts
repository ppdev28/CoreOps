import { request } from "../../shared/api/client";
import type {
  Charts,
  Context,
  Integrations,
  Overview,
  Resource,
  Alert,
  Target,
  TimeWindow,
} from "./model";
export function params(c: Context, w?: TimeWindow) {
  const q = new URLSearchParams({
    resource: c.resource,
    job: c.job,
    instance: c.instance,
  });
  if (w) Object.entries(w).forEach(([k, v]) => q.set(k, String(v)));
  return q;
}
export const integrations = (signal?: AbortSignal) =>
  request<Integrations>("/observability/integrations", { signal });
export const targets = (signal?: AbortSignal) =>
  request<Target[]>("/observability/targets", { signal });
export const overview = (c: Context, w: TimeWindow, signal?: AbortSignal) =>
  request<Overview>(`/observability/summary?${params(c, w)}`, { signal });
export const charts = (
  c: Context,
  w: TimeWindow,
  ids: string[],
  signal?: AbortSignal,
) => {
  const q = params(c, w);
  q.set("metrics", ids.join(","));
  return request<Charts>(`/observability/series?${q}`, { signal });
};
export const resource = (id: string, w: TimeWindow, signal?: AbortSignal) =>
  request<{ resource: Resource; alerts: Alert[]; charts: Charts }>(
    `/observability/resources/${encodeURIComponent(id)}?${new URLSearchParams(Object.entries(w).map(([k, v]) => [k, String(v)]))}`,
    { signal },
  );
export const grafana = (c: Context, w: TimeWindow, kind: string) => {
  const q = params(c, w);
  q.set("kind", kind);
  return request<{ url: string }>(`/observability/grafana-link?${q}`);
};
