import { request } from "../shared/api/client";
const endpoint = (target: string) =>
  `/terminal/passwords/${encodeURIComponent(target)}`;
export const terminalPasswordStatus = (target: string, signal?: AbortSignal) =>
  request<{ saved: boolean }>(endpoint(target), { signal, cache: "no-store" });
export const saveTerminalPassword = (
  target: string,
  password: string,
  signal?: AbortSignal,
) =>
  request<{ saved: boolean }>(endpoint(target), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    signal,
    cache: "no-store",
  });
export const forgetTerminalPassword = (target: string, signal?: AbortSignal) =>
  request<{ saved: boolean }>(endpoint(target), {
    method: "DELETE",
    signal,
    cache: "no-store",
  });
export const revealTerminalPassword = (target: string, signal?: AbortSignal) =>
  request<{ password: string }>(`${endpoint(target)}/reveal`, {
    method: "POST",
    signal,
    cache: "no-store",
  });
export function isSafeTerminalPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).length <= 1024 &&
    !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)
  );
}
