import { request } from "../shared/api/client";
import type { AuthUser, Role } from "./auth";
export const listUsers = (signal?: AbortSignal) =>
  request<AuthUser[]>("/users", { signal });
export const createUser = (name: string, password: string, role: Role) =>
  request<AuthUser>("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password, role }),
  });
export type PowerAction = "poweroff" | "suspend" | "reboot";
export interface PowerInfo {
  hostname: string;
  bootId: string;
  mode: string;
  actions: { id: PowerAction; available: boolean; reason?: string }[];
}
export const getPowerInfo = (signal?: AbortSignal) =>
  request<PowerInfo>("/host/power", { signal, cache: "no-store" });
export async function submitPower(
  info: PowerInfo,
  action: PowerAction,
  requestId: string,
) {
  const result = await request<{
    accepted: boolean;
    action: string;
    requestId: string;
  }>("/host/power", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hostname: info.hostname,
      bootId: info.bootId,
      action,
      requestId,
    }),
  });
  if (
    !result.accepted ||
    result.action !== action ||
    result.requestId !== requestId
  )
    throw new Error(
      "Power request outcome is unconfirmed. Verify the host before another request.",
    );
}
