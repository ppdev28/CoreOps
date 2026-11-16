import { test, expect } from "@playwright/test";
import { mockObservability } from "./observability-fixtures";

test("observability shares filters and time range across sections, reload and Grafana", async ({
  page,
}) => {
  const c = await mockObservability(page);
  await page.goto("/?view=observability");
  const view = page.locator("[data-observability]");
  await expect(view.getByText("Prometheus: Connected")).toBeVisible();
  await view.getByLabel("Time range", { exact: true }).selectOption("24h");
  await view.getByLabel("Resource", { exact: true }).selectOption("host");
  await view.getByLabel("Instance", { exact: true }).selectOption("host:19100");
  await view
    .getByRole("button", { name: "Infrastructure", exact: true })
    .click();
  await expect(
    view.getByText("ubuntu-real-fixture", { exact: true }),
  ).toBeVisible();
  await expect(
    view.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  const last = c.requests.filter((u) => u.pathname.endsWith("/series")).at(-1)!;
  expect(last.searchParams.get("instance")).toBe("host:19100");
  expect(
    Number(last.searchParams.get("to")) - Number(last.searchParams.get("from")),
  ).toBe(86400);
  await page.reload();
  await expect(view.getByLabel("Time range", { exact: true })).toHaveValue(
    "24h",
  );
  await expect(view.getByLabel("Instance", { exact: true })).toHaveValue(
    "host:19100",
  );
  await expect(
    view.getByRole("button", { name: "Infrastructure", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page
    .context()
    .route("https://grafana.test/**", (route) =>
      route.fulfill({ body: "Grafana context test destination" }),
    );
  const popupPromise = page.waitForEvent("popup");
  await view.getByRole("button", { name: "Host dashboard" }).click();
  const popup = await popupPromise;
  await popup.waitForURL("https://grafana.test/**");
  const u = new URL(popup.url());
  expect(u.searchParams.get("var-instance")).toBe("host:19100");
  expect(
    Number(u.searchParams.get("to")) - Number(u.searchParams.get("from")),
  ).toBe(86400000);
  await popup.close();
  expect(c.runtimeErrors).toEqual([]);
});

test("alert investigation preserves resource and reflects recovery without inventing history", async ({
  page,
}) => {
  const c = await mockObservability(page);
  await page.goto("/?view=observability&obs_tab=alerts");
  const view = page.locator("[data-observability]");
  await view.getByRole("button", { name: /HostCPUHigh/ }).click();
  await expect(view.getByLabel("Instance", { exact: true })).toHaveValue(
    "host:19100",
  );
  await expect(view.locator(".obs-alert-detail")).toContainText(
    "Required duration 600s",
  );
  await expect(view.getByLabel("Time range", { exact: true })).toHaveValue(
    "1h",
  );
  await expect(
    view.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  c.active = false;
  await view.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(view.locator(".obs-alert-detail")).toContainText(
    "No longer active at latest successful query",
  );
  c.mode = "prometheus-down";
  await view.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(view.locator(".obs-alert-detail")).toContainText(
    "Current state unknown",
  );
  await expect(view.getByText("Prometheus: Unavailable")).toBeVisible();
  expect(c.runtimeErrors).toEqual([]);
});

test("source failure, no data, source independence and CoreOps permissions are distinct", async ({
  page,
}) => {
  const c = await mockObservability(page);
  c.mode = "empty";
  await page.goto("/?view=observability");
  const v = page.locator("[data-observability]");
  await expect(
    v.getByText("No finite samples in this interval").first(),
  ).toBeVisible();
  c.mode = "grafana-down";
  await v.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(v.getByText("Grafana: Unavailable")).toBeVisible();
  await expect(v.locator(".recharts-line-curve").first()).toBeVisible();
  c.mode = "prometheus-down";
  await v.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    v.getByRole("alert").filter({ hasText: "connection failed" }).first(),
  ).toBeVisible();
  await expect(v.locator(".recharts-line-curve").first()).toBeVisible();
  await expect(v.getByText(/Data may be stale/)).toBeVisible();
  c.mode = "forbidden";
  await v.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(v.getByText(/Permission denied: your CoreOps/)).toBeVisible();
  expect(c.runtimeErrors).toEqual([]);
});

test("pause, custom interval validation, gaps and partial query errors retain samples", async ({
  page,
}) => {
  const c = await mockObservability(page);
  c.mode = "gap";
  await page.clock.install();
  await page.goto("/?view=observability");
  const v = page.locator("[data-observability]");
  await expect(v.locator(".recharts-line-curve").first()).toBeVisible();
  const path = await v
    .locator(".recharts-line-curve")
    .first()
    .getAttribute("d");
  expect((path?.match(/M/g) || []).length).toBeGreaterThan(1);
  await v.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    v.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  const n = c.requests.length;
  await page.clock.runFor(65000);
  expect(c.requests.length).toBe(n);
  c.mode = "query-error";
  await v.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    v.getByRole("alert").filter({ hasText: "Query timed out" }),
  ).toBeVisible();
  await expect(v.locator(".recharts-line-curve").first()).toBeVisible();
  await v.getByLabel("Time range", { exact: true }).selectOption("custom");
  await v.getByLabel("From", { exact: true }).fill("2026-11-16T10:00");
  await v.getByLabel("To", { exact: true }).fill("2026-11-16T09:00");
  await v.getByRole("button", { name: "Apply interval", exact: true }).click();
  await expect(v.getByText(/Choose a valid interval/)).toBeVisible();
  expect(c.runtimeErrors).toEqual([]);
});

for (const width of [320, 768, 1920])
  test(`observability responsive detail at ${width}px`, async ({
    page,
  }, info) => {
    const c = await mockObservability(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      "/?view=observability&obs_tab=infrastructure&obs_resource=host",
    );
    const v = page.locator("[data-observability]");
    await expect(
      v.getByText("ubuntu-real-fixture", { exact: true }),
    ).toBeVisible();
    await v.getByRole("button", { name: /ubuntu-real-fixture/ }).click();
    await expect(v.getByLabel("Instance", { exact: true })).toHaveValue(
      "host:19100",
    );
    await expect(v.locator(".recharts-line-curve").first()).toBeVisible();
    expect(await v.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(
      true,
    );
    expect(c.runtimeErrors).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`observability-${width}.png`),
      fullPage: true,
    });
  });

// TargetDown is generic at rule level; its affected resource is identified by job/instance.
test("generic target alert resolves against its host context and keeps an advancing investigation window", async ({
  page,
}) => {
  const c = await mockObservability(page);
  c.ruleName = "TargetDown";
  await page.goto("/?view=observability&obs_tab=alerts");
  const v = page.locator("[data-observability]");
  await v.getByRole("button", { name: /TargetDown/ }).click();
  await expect(v.getByLabel("Resource", { exact: true })).toHaveValue("host");
  await expect(v.getByLabel("Time range", { exact: true })).toHaveValue("1h");
  await expect(v.locator(".obs-alert-detail .obs-badge")).toHaveText("firing");
  await expect(
    v.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  c.active = false;
  await v.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(v.locator(".obs-alert-detail")).toContainText(
    "No longer active at latest successful query",
  );
  expect(c.runtimeErrors).toEqual([]);
});
