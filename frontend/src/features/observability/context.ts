import { useCallback, useEffect, useState } from "react";
import type { Context } from "./model";
export function readContext(): Context {
  const p = new URLSearchParams(location.search);
  const one = <T extends string>(
    key: string,
    allowed: readonly T[],
    fallback: T,
  ): T =>
    allowed.includes(p.get(`obs_${key}`) as T)
      ? (p.get(`obs_${key}`) as T)
      : fallback;
  const now = Math.floor(Date.now() / 1000);
  const num = (key: string, fallback: number) => {
    const n = Number(p.get(`obs_${key}`));
    return Number.isSafeInteger(n) && n > 0 ? n : fallback;
  };
  return {
    tab: one(
      "tab",
      ["overview", "infrastructure", "services", "alerts", "integrations"],
      "overview",
    ),
    resource: one("resource", ["all", "host", "coreops"], "all"),
    job: p.get("obs_job") || "",
    instance: p.get("obs_instance") || "",
    range: one("range", ["15m", "1h", "6h", "24h", "custom"], "1h"),
    from: num("from", now - 3600),
    to: num("to", now),
    refresh: Number(one("refresh", ["15", "30", "60", "120"], "30")),
    paused: p.get("obs_paused") === "true",
  };
}
export function useContext() {
  const [context, set] = useState(readContext);
  useEffect(() => {
    const handler = () => set(readContext());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  const update = useCallback(
    (patch: Partial<Context>) => {
      const next = { ...context, ...patch };
      const url = new URL(location.href);
      url.searchParams.set("view", "observability");
      Object.entries(next).forEach(([k, v]) =>
        url.searchParams.set(`obs_${k}`, String(v)),
      );
      history.pushState(null, "", url);
      set(next);
    },
    [context],
  );
  return [context, update] as const;
}
