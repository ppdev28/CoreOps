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
