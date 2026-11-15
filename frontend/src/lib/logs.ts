import type { LogEntry } from "./types";
export type LogSource = {
  id: string;
  name: string;
  kind: "all" | "system" | "container" | "file" | "events";
  containerId?: string;
  filePath?: string;
  category?: "all" | "kernel" | "services" | "security";
};
export const ALL_LOGS: LogSource = { id: "all", name: "All logs", kind: "all" };
export const SYSTEM_LOGS: LogSource = {
  id: "system",
  name: "System journal",
  kind: "system",
};
export const HOST_LOG_SOURCES: LogSource[] = [
  SYSTEM_LOGS,
  { id: "kernel", name: "Kernel events", kind: "system", category: "kernel" },
  {
    id: "services",
    name: "Service events",
    kind: "system",
    category: "services",
  },
  {
    id: "security",
    name: "Authentication & audit",
    kind: "system",
    category: "security",
  },
  { id: "events", name: "Docker events", kind: "events" },
];
export const LOG_LEVELS = ["ERROR", "WARN", "INFO", "NOTICE", "DEBUG"] as const;
// Log data is untrusted text. Strip terminal controls in one pass rather than
// interpreting escape sequences or using HTML (including OSC links/clipboard).
export function cleanLogMessage(message: string) {
  const output: string[] = [];
  for (let index = 0; index < message.length; index++) {
    const code = message.charCodeAt(index);
    if (code === 27) {
      const next = message[++index];
      if (next === "[") {
        while (index + 1 < message.length) {
          const value = message.charCodeAt(++index);
          if (value >= 64 && value <= 126) break;
        }
      } else if (next === "]" || next === "P" || next === "_" || next === "^") {
        while (index + 1 < message.length) {
          const value = message.charCodeAt(++index);
          if (value === 7) break;
          if (value === 27 && message[index + 1] === "\\") {
            index++;
            break;
          }
        }
      }
      continue;
    }
    if (
      code <= 8 ||
      (code >= 11 && code <= 12) ||
      (code >= 14 && code <= 31) ||
      code === 127
    )
      continue;
    output.push(message[index]);
  }
  return output.join("");
}
export function normalizedLevel(level: string) {
  const value = level.toUpperCase();
  if (["FATAL", "PANIC", "ERR"].includes(value)) return "ERROR";
  if (value === "WARNING") return "WARN";
  if (value === "TRACE") return "DEBUG";
  return value;
}
export function logTime(timestamp: string) {
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) return "—";
  return new Date(timestamp).toISOString().slice(11, 23);
}
export function logText(entry: LogEntry) {
  return [
    entry.timestamp || "—",
    normalizedLevel(entry.level),
    entry.source,
    cleanLogMessage(entry.message),
  ].join(" ");
}
export function downloadLogEntries(entries: LogEntry[], name: string) {
  const blob = new Blob([entries.map(logText).join("\n") + "\n"], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `coreops-${name.replace(/[^a-zA-Z0-9_.-]/g, "-")}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function copyLogText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied)
    throw new Error(
      "Copy is unavailable here. Select the log text and copy it using your browser.",
    );
}
