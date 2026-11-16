import type { Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";
export async function mockObservability(page: Page) {
  const dashboard = await mockDashboard(page, "healthy", "viewer");
  const control = {
    ...dashboard,
    mode: "healthy",
    active: true,
    ruleName: "HostCPUHigh",
    requests: [] as URL[],
    delay: false,
  };
  await page.route("**/api/v1/observability/**", async (route) => {
    const u = new URL(route.request().url()),
      path = u.pathname.split("/observability/")[1];
    control.requests.push(u);
    const bad = control.mode === "prometheus-down";
    const prom = {
      configured: true,
      healthy: !bad,
      endpoint: "http://prometheus.test:9090",
      ...(bad ? { error: "Connection failed" } : { version: "test" }),
    };
    const graf = {
      configured: true,
      healthy: control.mode !== "grafana-down",
      endpoint: "http://grafana-internal.test:3000",
      publicUrl: "https://grafana.test",
      ...(control.mode === "grafana-down"
        ? { error: "Grafana is unavailable" }
        : { version: "test" }),
    };
    if (path === "integrations")
      return route.fulfill({ json: { prometheus: prom, grafana: graf } });
    if (control.mode === "forbidden")
      return route.fulfill({ status: 403, json: { error: "Forbidden" } });
    if (bad)
      return route.fulfill({
        status: 503,
        json: { error: "observability source unavailable: connection failed" },
      });
    if (control.delay) await new Promise((r) => setTimeout(r, 250));
    const all = [
      {
        id: "host1",
        kind: "host",
        job: "coreops-host",
        instance: "host:19100",
        health: "up",
        lastScrape: new Date().toISOString(),
        lastError: "",
        scrapeDuration: 0.02,
        scrapeInterval: "15s",
      },
      {
        id: "api1",
        kind: "coreops",
        job: "coreops-api",
        instance: "api:8082",
        health: "up",
        lastScrape: new Date().toISOString(),
        lastError: "",
        scrapeDuration: 0.01,
        scrapeInterval: "15s",
      },
    ];
    const selected = all.filter(
      (t) =>
        (!u.searchParams.get("resource") ||
          u.searchParams.get("resource") === "all" ||
          u.searchParams.get("resource") === t.kind) &&
        (!u.searchParams.get("job") || u.searchParams.get("job") === t.job) &&
        (!u.searchParams.get("instance") ||
          u.searchParams.get("instance") === t.instance),
    );
    const alert = {
      name: control.ruleName,
      state: "firing",
      labels: {
        job: "coreops-host",
        instance: "host:19100",
        severity: "warning",
        coreops_resource: control.ruleName === "TargetDown" ? "target" : "host",
      },
      annotations: {
        summary: "High CPU on host:19100",
        description: "CPU is sustained above the threshold.",
        check: "Check workload activity before diagnosing a cause.",
      },
      activeAt: new Date(Date.now() - 900000).toISOString(),
      value: 92,
      expression:
        '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))) > 85',
      duration: 600,
      health: "ok",
      lastError: "",
    };
    const alerts =
      control.active && selected.some((t) => t.kind === "host") ? [alert] : [];
    if (path === "targets")
      return route.fulfill({ json: control.mode === "empty" ? [] : all });
    if (path === "summary")
      return route.fulfill({
        json: {
          summary: {
            targetsUp: selected.length,
            targetsTotal: selected.length,
            pending: 0,
            firing: alerts.length,
            hostCount: selected.filter((t) => t.kind === "host").length,
            cpu: 42,
            memory: 50,
            rps: 2,
            errors: 0,
            p95: 0.09,
            trafficState: "traffic",
          },
          targets: selected,
          resources:
            control.mode === "empty"
              ? []
              : selected.map((t) => ({
                  ...t,
                  name:
                    t.kind === "host"
                      ? "ubuntu-real-fixture"
                      : "CoreOps backend",
                  lastCollected: Date.now() / 1000,
                  metrics: {
                    host_cpu: 42,
                    host_memory: 50,
                    host_disk_worst: 61,
                    host_uptime: 86400,
                    api_rps: 2,
                    api_p95: 0.09,
                  },
                })),
          alerts,
          rules: [
            { ...alert, alerts, state: alerts.length ? "firing" : "inactive" },
          ],
          metrics: {},
          errors: {},
          queriedAt: new Date().toISOString(),
        },
      });
    if (path === "series") {
      const from = Number(u.searchParams.get("from")),
        to = Number(u.searchParams.get("to")),
        step = Number(u.searchParams.get("step"));
      const results = (u.searchParams.get("metrics") || "")
        .split(",")
        .map((id) => {
          const unit =
            id === "api_memory"
              ? "B"
              : id.includes("p95") ||
                  id.includes("p50") ||
                  id.includes("p99") ||
                  id.includes("uptime")
                ? "s"
                : id.includes("rps") || id === "api_routes"
                  ? "req/s"
                  : id.includes("rx") || id.includes("tx")
                    ? "B/s"
                    : "%";
          const points = [];
          for (let t = from; t <= to; t += step)
            points.push({
              time: t * 1000,
              value:
                control.mode === "gap" &&
                t > from + (to - from) / 3 &&
                t < from + (2 * (to - from)) / 3
                  ? null
                  : unit === "s"
                    ? 0.09 + 0.01 * Math.sin((t - from) / step)
                    : 42 + 4 * Math.sin((t - from) / step),
            });
          return {
            metric: {
              id,
              kind: id.startsWith("host") ? "host" : "coreops",
              name: id,
              unit,
              description: "Test fixture: centralized 5m calculation",
              expression: "rate(test_counter[5m])",
            },
            data: {
              series:
                control.mode === "empty"
                  ? []
                  : [
                      {
                        labels:
                          id === "api_routes"
                            ? {
                                method: "GET",
                                route: "/api/v1/containers/{id}",
                              }
                            : {
                                instance: selected[0]?.instance || "host:19100",
                              },
                        points,
                      },
                    ],
              warnings:
                control.mode === "partial" ? ["Test partial response"] : [],
            },
            ...(control.mode === "query-error"
              ? { error: "Query timed out" }
              : {}),
          };
        });
      return route.fulfill({
        json: {
          window: { from, to, step },
          results,
          queriedAt: new Date().toISOString(),
        },
      });
    }
    if (path === "grafana-link")
      return route.fulfill({
        json: {
          url: `https://grafana.test/d/coreops-${u.searchParams.get("kind") === "host" ? "host" : "backend"}?from=${Number(u.searchParams.get("from")) * 1000}&to=${Number(u.searchParams.get("to")) * 1000}&var-instance=${encodeURIComponent(u.searchParams.get("instance") || "$__all")}`,
        },
      });
    return route.fulfill({
      status: 404,
      json: { error: "Unknown observability fixture" },
    });
  });
  return control;
}
