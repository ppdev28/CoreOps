import type { OpenPort } from "./types";
export function protocol(port: OpenPort) {
  return port.proto.toUpperCase().replace(/6$/, "");
}
export function portSource(port: OpenPort) {
  return !port.container || ["—", "-"].includes(port.container)
    ? "unknown"
    : port.container === "Host"
      ? "host"
      : "docker";
}
export const sourceNames = {
  host: "Host / unmapped",
  docker: "Docker bindings",
  unknown: "Unknown attribution",
};
export function bindType(port: OpenPort) {
  const address = port.address
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/^::ffff:/, "");
  if (!address || ["—", "-"].includes(address)) return "unknown";
  if (address === "::1" || /^127(?:\.\d{1,3}){3}$/.test(address))
    return "loopback";
  if (["*", "0.0.0.0", "::"].includes(address)) return "wildcard";
  return "specific";
}
export function portRanges(value: string): [number, number][] | null {
  if (!value.trim()) return [];
  const ranges: [number, number][] = [];
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/);
    if (!match) return null;
    const low = Number(match[1]),
      high = Number(match[2] || match[1]);
    if (low < 1 || high > 65535 || low > high) return null;
    ranges.push([low, high]);
  }
  return ranges;
}
