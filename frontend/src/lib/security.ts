import { request } from "../shared/api/client";
import type { SecurityCheck, SecurityEvent } from "./types";
export interface EvidenceStatus {
  state: string;
  detail?: string;
}
export interface SecuritySignal {
  observedAt?: string;
  id: string;
  rule: string;
  severity: string;
  summary: string;
  count: number;
  evidenceIds: string[];
}
export interface SecurityMonitor {
  state: string;
  detail: string;
  lastCollected: string;
  coverageSince: string;
  backlog: boolean;
  retainedEvents: number;
  signals: SecuritySignal[];
}
export interface SecurityEventPage {
  events: SecurityEvent[];
  signals: SecuritySignal[];
  oldestCursor: string;
  newestCursor: string;
  hasMore: boolean;
  source: EvidenceStatus;
  updatedAt: string;
}
export interface SecurityPosture {
  apt: {
    installed: boolean | null;
    origins: string[];
    exclusions: string[];
    lastRun: string;
    lastResult: string;
    rebootRequired: boolean | null;
  };
  jails: {
    name: string;
    logPaths: string[];
    journalMatch: string;
    actions: string;
    failRegexCount: number;
    maxRetry: number;
    findTime: number;
    banTime: number;
    currentlyBanned: number;
    totalBanned: number;
    status: EvidenceStatus;
  }[];
  jailsTruncated: boolean;
  chains: {
    family: string;
    table: string;
    name: string;
    hook: string;
    policy: string;
    rules: number;
  }[];
  sensors: {
    scheduled?: boolean | null;
    lastRun?: string;
    lastResult?: string;
    signatureUpdatedAt?: string;
    id: string;
    label: string;
    kind: string;
    installed: boolean | null;
    active: boolean | null;
    detail: string;
  }[];
  sources: Record<string, EvidenceStatus>;
}
export interface SSHPolicy {
  context: { user: string; address: string; host: string };
  checks: SecurityCheck[];
  authenticationMethods: string;
  allowUsers: string;
  denyUsers: string;
  source: EvidenceStatus;
}
export interface ScanCapabilities {
  available: boolean;
  reason: string;
  hostname: string;
  bootId: string;
  version: string;
  targets: { id: string; label: string; kind: string }[];
}
export interface Vulnerability {
  status?: string;
  id: string;
  package: string;
  installed: string;
  fixed: string;
  severity: string;
  title: string;
  url: string;
  target: string;
}
export interface ScanReport {
  uniqueAdvisories?: number;
  fixAvailable?: number;
  scanner: string;
  scannedAt: string;
  databaseUpdatedAt: string;
  os: string;
  endOfLife: boolean;
  packages: number;
  vulnerabilities: Vulnerability[];
  counts: Record<string, number>;
  truncated: boolean;
  coverage: string;
}
export interface ScanJob {
  id: string;
  target: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  report?: ScanReport;
}
export const getSecurityPosture = (signal?: AbortSignal) =>
  request<SecurityPosture>("/security/posture", { signal });
export const getSecurityMonitor = (signal?: AbortSignal) =>
  request<SecurityMonitor>("/security/monitor", { signal });
export function getSecurityEvents(
  category: string,
  cursor = "",
  direction = "older",
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ category, direction, limit: "100" });
  if (cursor) params.set("cursor", cursor);
  return request<SecurityEventPage>(`/security/events?${params}`, { signal });
}
export function getSSHPolicy(
  user: string,
  address: string,
  host: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ user, address, host });
  return request<SSHPolicy>(`/security/ssh-policy?${params}`, { signal });
}
export const getScanCapabilities = (signal?: AbortSignal) =>
  request<ScanCapabilities>("/security/scans/capabilities", { signal });
export const getScanJobs = (signal?: AbortSignal) =>
  request<ScanJob[]>("/security/scans", { signal });
export function startScan(caps: ScanCapabilities, target: string) {
  const requestId = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  return request<ScanJob>("/security/scans", {
    method: "POST",
    body: JSON.stringify({
      target,
      hostname: caps.hostname,
      bootId: caps.bootId,
      requestId,
    }),
  });
}
export const resetSecurityMonitor = () =>
  request<{ accepted: boolean }>("/security/monitor/reset", {
    method: "POST",
    body: JSON.stringify({ acknowledgeGap: true }),
  });
