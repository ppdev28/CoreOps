import { test, expect, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";

const cluster = {
  id: "0123456789abcdef0123",
  name: "Production",
  server: "https://cluster.test:6443",
  namespaces: ["apps", "default"],
};
const base = {
  namespace: "apps",
  version: "10",
  created: "2026-11-14T10:00:00Z",
  phase: "",
  ready: false,
  problem: false,
  reason: "",
  message: "",
  available: 1,
  desired: 2,
  updated: 2,
  restarts: 0,
  node: "",
  images: ["registry.test/api:v2"],
  conditions: [],
  containers: [],
  cpu: "",
  memory: "",
  allocatableCpu: "",
  allocatableMemory: "",
  podCount: null,
  owners: [],
  generation: 2,
  observedGeneration: 2,
};
const deployment = {
  ...base,
  kind: "deployments",
  name: "checkout-api",
  uid: "deployment-uid",
  problem: true,
  reason: "MinimumReplicasUnavailable",
  message: "Deployment does not have minimum availability.",
  conditions: [
    {
      type: "Available",
      status: "False",
      reason: "MinimumReplicasUnavailable",
      message: "Deployment does not have minimum availability.",
    },
  ],
};
const pod = {
  ...base,
  kind: "pods",
  name: "checkout-api-78d5d",
  uid: "pod-uid",
  phase: "Running",
  ready: false,
  problem: true,
  available: 0,
  desired: 1,
  restarts: 4,
  node: "worker-01",
  reason: "CrashLoopBackOff",
  message: "Back-off restarting failed container.",
  containers: [
    {
      name: "api",
      image: "registry.test/api:v2",
      ready: false,
      restarts: 4,
      state: "waiting",
      reason: "CrashLoopBackOff",
      message: "Back-off restarting failed container.",
      init: false,
      requests: { cpu: "100m", memory: "128Mi" },
      limits: { memory: "512Mi" },
    },
  ],
};
const healthyPod = {
  ...pod,
  name: "gateway-99bd",
  uid: "gateway-uid",
  ready: true,
  problem: false,
  available: 1,
  restarts: 0,
  reason: "",
  message: "",
  containers: [
    {
      ...pod.containers[0],
      ready: true,
      restarts: 0,
      state: "running",
      reason: "",
      message: "",
    },
  ],
};
const node = {
  ...base,
  kind: "nodes",
  name: "worker-01",
  namespace: "",
  uid: "node-uid",
  ready: true,
  problem: false,
  cpu: "8",
  memory: "16Gi",
  allocatableCpu: "7500m",
  allocatableMemory: "15Gi",
  podCount: 2,
};
const events = [
  {
    uid: "event-uid",
    resourceUid: pod.uid,
    resource: pod.name,
    namespace: "apps",
    type: "Warning",
    reason: "BackOff",
    message: "Back-off restarting failed container api",
    time: "2026-11-15T10:00:00Z",
    count: 4,
  },
];
async function setup(
  page: Page,
  role: "viewer" | "operator" | "admin" = "admin",
  empty = false,
) {
  const control = await mockDashboard(page, "healthy", role);
  const state = {
    empty,
    offline: false,
    denied: false,
    recovered: false,
    logFailure: false,
    logReads: 0,
    actions: [] as { url: string; body: any }[],
    snapshots: [] as string[],
    connections: [] as unknown[],
  };
  await page.route("**/api/v1/kubernetes/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      p = u.pathname;
    if (p.endsWith("/clusters") && req.method() === "GET")
      return route.fulfill({ json: state.empty ? [] : [cluster] });
    if (p.endsWith("/clusters") && req.method() === "POST") {
      state.connections.push(req.postDataJSON());
      state.empty = false;
      return route.fulfill({ status: 201, json: cluster });
    }
    if (p.endsWith("/snapshot")) {
      state.snapshots.push(u.searchParams.get("namespace") || "");
      if (state.offline)
        return route.fulfill({
          status: 502,
          json: { error: "Kubernetes connection failed" },
        });
      return route.fulfill({
        json: {
          namespaces: ["apps", "default"],
          resources: state.denied
            ? { deployments: [], nodes: [] }
            : {
                deployments: [
                  state.recovered
                    ? {
                        ...deployment,
                        ready: true,
                        problem: false,
                        available: 3,
                        desired: 3,
                        updated: 3,
                        generation: 3,
                        observedGeneration: 3,
                      }
                    : deployment,
                ],
                statefulsets: [],
                daemonsets: [],
                pods: [pod, healthyPod],
                nodes: [node],
              },
          events,
          errors: state.denied
            ? {
                pods: "Cluster RBAC does not permit this operation",
                metrics:
                  "Metrics API is unavailable or not permitted; no usage values are estimated.",
              }
            : {
                metrics:
                  "Metrics API is unavailable or not permitted; no usage values are estimated.",
              },
          metrics: null,
          nodeUsage: {},
          updatedAt: "2026-11-15T10:00:00Z",
        },
      });
    }
    if (
      req.method() === "POST" &&
      (p.endsWith("/scale") || p.endsWith("/restart"))
    ) {
      state.actions.push({ url: p, body: req.postDataJSON() });
      state.recovered = true;
      return route.fulfill({
        status: 202,
        json: { accepted: true, message: "Accepted; waiting for rollout" },
      });
    }
    if (p.endsWith("/logs")) {
      state.logReads++;
      if (state.logFailure)
        return route.fulfill({
          status: 403,
          json: { error: "Cluster RBAC does not permit logs" },
        });
      return route.fulfill({
        json: {
          text: `2026-11-15T10:00:00Z ${u.searchParams.get("previous") === "true" ? "previous process exited" : "error: database connection refused"}\n2026-11-15T10:00:01Z retrying database\n`,
          updatedAt: "2026-11-15T10:00:01Z",
        },
      });
    }
    if (p.endsWith("/yaml"))
      return route.fulfill({
        json: {
          yaml: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: checkout-api\n",
        },
      });
    let resource = p.includes("/pods/")
      ? p.includes(healthyPod.name)
        ? healthyPod
        : pod
      : p.includes("/nodes/")
        ? node
        : deployment;
    if (state.recovered && resource.kind === "deployments")
      resource = {
        ...resource,
        ready: true,
        problem: false,
        available: 3,
        desired: 3,
        updated: 3,
        generation: 3,
        observedGeneration: 3,
      } as typeof resource;
    return route.fulfill({
      json: {
        resource,
        pods: [pod, healthyPod],
        events,
        permissions: {
          scale: role !== "viewer",
          restart: role !== "viewer",
          logs: role !== "viewer",
          yaml: role !== "viewer",
        },
        errors: {},
      },
    });
  });
  await page.goto("/");
  await navigate(page, "Kubernetes");
  return { state, control };
}
async function navigate(page: Page, name: string) {
  if ((page.viewportSize()?.width || 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name, exact: true })
    .filter({ visible: true })
    .click();
}
const screen = (page: Page) => page.locator('[data-screen="kubernetes"]');

test("namespace/search/state survive tabs and navigating away; metrics stay unavailable", async ({
  page,
}) => {
  const { state, control } = await setup(page);
  const s = screen(page);
  await expect(s.getByText("Cluster at a glance")).toBeVisible();
  await expect(
    s.getByText("No values estimated", { exact: true }),
  ).toBeVisible();
  await s.getByLabel("Namespace", { exact: true }).selectOption("apps");
  await s.getByLabel("Search Kubernetes resources").fill("checkout");
  await s.getByLabel("Resource status").selectOption("attention");
  await s.getByRole("button", { name: "Workloads", exact: true }).click();
  await expect(
    s.getByRole("button", { name: /checkout-api apps/ }),
  ).toBeVisible();
  await s.getByRole("button", { name: "Pods", exact: true }).click();
  await expect(s.getByText(pod.name, { exact: true })).toBeVisible();
  await expect(s.getByText(healthyPod.name, { exact: true })).toHaveCount(0);
  await navigate(page, "Host");
  await navigate(page, "Kubernetes");
  await expect(s.getByLabel("Namespace", { exact: true })).toHaveValue("apps");
  await expect(s.getByLabel("Search Kubernetes resources")).toHaveValue(
    "checkout",
  );
  await expect(s.getByLabel("Resource status")).toHaveValue("attention");
  expect(state.snapshots).toContain("apps");
  expect(control.runtimeErrors).toEqual([]);
});
test("diagnose a pod using events, live and previous logs, pause/search/download", async ({
  page,
}) => {
  const { state } = await setup(page);
  const s = screen(page);
  await s
    .getByRole("button", { name: "Incidents", exact: false })
    .first()
    .click();
  await s.getByRole("button", { name: pod.name, exact: true }).click();
  await expect(s.getByText("Running", { exact: true })).toBeVisible();
  await expect(
    s.getByText("waiting · Not ready", { exact: true }),
  ).toBeVisible();
  await s.getByRole("button", { name: /^Events/ }).click();
  await expect(s.getByText(events[0].message, { exact: true })).toBeVisible();
  await s.getByRole("button", { name: "Logs", exact: true }).click();
  await expect(s.getByLabel("Pod log output")).toContainText(
    "database connection refused",
  );
  await s.getByRole("button", { name: "Pause", exact: true }).click();
  const reads = state.logReads;
  await page.waitForTimeout(2800);
  expect(state.logReads).toBe(reads);
  await s.getByLabel("Search pod logs").fill("refused");
  await expect(s.getByLabel("Pod log output")).not.toContainText("retrying");
  const download = page.waitForEvent("download");
  await s.getByRole("button", { name: "Download", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("checkout-api");
  await s.getByLabel("Previous execution", { exact: true }).check();
  await s.getByLabel("Search pod logs").fill("");
  await expect(s.getByLabel("Pod log output")).toContainText(
    "previous process exited",
  );
});
test("scale requires resource review and verifies actual controller recovery", async ({
  page,
}) => {
  const { state } = await setup(page);
  const s = screen(page);
  await s.getByRole("button", { name: "Workloads", exact: true }).click();
  await s.getByRole("button", { name: /checkout-api apps/ }).click();
  await s.getByRole("button", { name: "Scale", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("checkout-api", { exact: true })).toBeVisible();
  await expect(dialog.getByText("apps", { exact: true })).toBeVisible();
  await dialog.getByLabel("Desired replicas").fill("3");
  expect(state.actions).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Confirm scale", exact: true })
    .click();
  await expect(s.getByText(/Recovery verified:/)).toBeVisible();
  expect(state.actions[0].body).toEqual({
    uid: "deployment-uid",
    version: "10",
    replicas: 3,
  });
  await s.getByRole("button", { name: "YAML", exact: true }).click();
  await expect(s.locator("pre")).toContainText("apiVersion: apps/v1");
  expect(await s.locator("textarea").count()).toBe(0);
});
test("viewer cannot mutate or read sensitive logs/YAML", async ({ page }) => {
  const { state } = await setup(page, "viewer");
  const s = screen(page);
  await expect(
    s.getByRole("button", { name: "Connections", exact: true }),
  ).toHaveCount(0);
  await s.getByRole("button", { name: "Workloads", exact: true }).click();
  await s.getByRole("button", { name: /checkout-api apps/ }).click();
  await expect(
    s.getByRole("button", { name: "Scale", exact: true }),
  ).toBeDisabled();
  await expect(
    s.getByRole("button", { name: "Rolling restart", exact: true }),
  ).toBeDisabled();
  await s.getByRole("button", { name: "YAML", exact: true }).click();
  await expect(
    s.getByText("Manifest access requires", { exact: false }),
  ).toBeVisible();
  expect(state.actions).toHaveLength(0);
});
test("connection errors preserve stale data and RBAC failures never look like healthy zeros", async ({
  page,
}) => {
  const { state } = await setup(page);
  const s = screen(page);
  await expect(s.getByText("Cluster at a glance")).toBeVisible();
  state.offline = true;
  await s
    .getByRole("button", { name: "Refresh Kubernetes", exact: true })
    .click();
  await expect(s.getByText(/Displaying stale data/)).toBeVisible();
  state.offline = false;
  state.denied = true;
  await s
    .getByRole("button", { name: "Refresh Kubernetes", exact: true })
    .click();
  await s.getByRole("button", { name: "Pods", exact: true }).click();
  await expect(
    s.getByText("Cluster RBAC does not permit this operation", { exact: true }),
  ).toBeVisible();
  await expect(s.getByText("No matching pods")).toHaveCount(0);
});
for (const viewport of [
  { width: 320, height: 740 },
  { width: 768, height: 1024 },
  { width: 1920, height: 1080 },
])
  test(`responsive resource detail and action dialog ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const { control } = await setup(page);
    const s = screen(page);
    await expect(s.getByText("Cluster at a glance")).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`kubernetes-overview-${viewport.width}.png`),
      fullPage: true,
    });
    await s.getByRole("button", { name: "Workloads", exact: true }).click();
    await s.getByRole("button", { name: /checkout-api apps/ }).click();
    await expect(
      s.getByText("Resource information", { exact: true }),
    ).toBeVisible();
    await s
      .getByRole("button", { name: "Rolling restart", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const overflow = await page.evaluate(() => ({
      body: document.documentElement.scrollWidth > innerWidth,
      dialog: (() => {
        const d = document.querySelector("dialog")!;
        return d.scrollWidth > d.clientWidth + 1;
      })(),
    }));
    expect(overflow).toEqual({ body: false, dialog: false });
    await page.screenshot({
      path: info.outputPath(`kubernetes-${viewport.width}.png`),
      fullPage: true,
    });
    expect(control.runtimeErrors).toEqual([]);
  });

test("admin connects from the empty state without persisting cluster credentials in browser storage", async ({
  page,
}) => {
  const { state } = await setup(page, "admin", true);
  const s = screen(page);
  await s
    .getByRole("button", { name: "Connect a cluster", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Connection name", { exact: true }).fill("Production");
  await d.getByLabel("API server", { exact: true }).fill(cluster.server);
  await d
    .getByLabel("Permitted namespaces", { exact: true })
    .fill("apps, default");
  await d
    .getByLabel("Bearer token", { exact: true })
    .fill("kube-test-private-token");
  await d
    .getByRole("button", { name: "Verify & connect", exact: true })
    .click();
  await expect(d).toHaveCount(0);
  await expect(s.getByText("Cluster at a glance")).toBeVisible();
  expect(state.connections[0]).toMatchObject({
    name: "Production",
    server: cluster.server,
    namespaces: ["apps", "default"],
    token: "kube-test-private-token",
  });
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  expect(storage).not.toContain("kube-test-private-token");
});
test("log errors retain a clearly stale snapshot and show actual read failures", async ({
  page,
}) => {
  const { state } = await setup(page);
  const s = screen(page);
  await s.getByRole("button", { name: "Pods", exact: true }).click();
  await s.getByRole("button", { name: new RegExp(pod.name) }).click();
  await s.getByRole("button", { name: "Logs", exact: true }).click();
  await expect(s.getByLabel("Pod log output")).toContainText(
    "database connection refused",
  );
  state.logFailure = true;
  await expect(s.getByText(/The retained log snapshot is stale/)).toBeVisible({
    timeout: 8000,
  });
  await expect(s.getByLabel("Pod log output")).toContainText(
    "database connection refused",
  );
});
