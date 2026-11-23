import { request } from "../shared/api/client";
export interface TailscalePreferences {
  hostname: string | null;
  wantRunning: boolean | null;
  acceptDNS: boolean | null;
  acceptRoutes: boolean | null;
  ssh: boolean | null;
  shieldsUp: boolean | null;
  exitNode: string;
  advertiseRoutes: string[];
}
export interface TailscalePeer {
  id: string;
  name: string;
  dnsName: string;
  os: string;
  ips: string[];
  online: boolean | null;
  active: boolean | null;
  exitNode: boolean;
  lastSeen?: string;
}
export interface TailscaleSnapshot {
  available: boolean;
  state: string;
  version: string;
  hostname: string;
  bootId: string;
  nodeId: string;
  dnsName: string;
  ips: string[];
  online: boolean | null;
  tailnet: string;
  health: string[];
  preferences: TailscalePreferences | null;
  permission: { available: boolean; mode: string; reason?: string };
  peers: TailscalePeer[];
  peerCount: number;
  peersTruncated: boolean;
  revision: string;
  signInUrl?: string;
  adminUrl?: string;
  detail?: string;
}
export type TailscaleChanges = Partial<
  Pick<
    TailscalePreferences,
    "hostname" | "acceptDNS" | "acceptRoutes" | "ssh" | "shieldsUp"
  >
>;
export interface TailscaleRequest {
  action: "connect" | "disconnect" | "configure" | "login";
  hostname: string;
  revision: string;
  requestId: string;
  changes: TailscaleChanges;
}
export const getTailscale = (signal?: AbortSignal) =>
  request<TailscaleSnapshot>("/tailscale", { signal, cache: "no-store" });
export const changeTailscale = (
  input: TailscaleRequest,
  signal?: AbortSignal,
) =>
  request<{ accepted: boolean; action: string; requestId: string }>(
    "/tailscale",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
      cache: "no-store",
    },
  );
export function tailscaleRequest(
  snapshot: TailscaleSnapshot,
  action: TailscaleRequest["action"],
  changes: TailscaleChanges = {},
): TailscaleRequest {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return {
    action,
    hostname: snapshot.hostname,
    revision: snapshot.revision,
    requestId: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    ),
    changes,
  };
}
