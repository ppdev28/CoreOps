import { test, expect, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";
async function nav(page: Page, name: string) {
  if ((page.viewportSize()?.width || 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name, exact: true })
    .click();
}
const apps = [
  {
    id: "homelab",
    name: "Homelab",
    description: "Web stack",
    status: "running",
    containers: 2,
    version: "stable",
    category: "Web",
    icon: "https://cdn.simpleicons.org/nginx",
    containerIds: ["abcdef123450", "abcdef123451"],
  },
  {
    id: "database",
    name: "Database",
    description: "Data service",
    status: "stopped",
    containers: 1,
    version: "16",
    category: "Database",
    icon: "https://cdn.simpleicons.org/postgresql",
    containerIds: ["db-test"],
  },
  {
    id: "broken",
    name: "Unknown app",
    description: "Custom service",
    status: "restarting",
    containers: 3,
    version: "1",
    category: "Labs",
    icon: "https://example.invalid/missing-brand.svg",
    containerIds: [],
  },
];
for (const width of [320, 1440])
  test(`application filters combine real metadata and bundled icons at ${width}px`, async ({
    page,
  }) => {
    const c = await mockDashboard(page);
    await page.setViewportSize({ width, height: 1100 });
    await page.route("**/api/v1/applications", (r) =>
      r.fulfill({ json: apps }),
    );
    await page.route("https://cdn.simpleicons.org/**", (r) => r.abort());
    await page.route("https://example.invalid/**", (r) => r.abort());
    await page.goto("/");
    await nav(page, "Applications");
    await expect(page.locator(".installed-application-card")).toHaveCount(3);
    const image = page
      .locator(".installed-application-card")
      .filter({ hasText: "Homelab" })
      .locator("img");
    await expect(image).toHaveAttribute(
      "src",
      /(nginx.*\.svg|^data:image\/svg\+xml)/,
    );
    await expect
      .poll(() =>
        image.evaluate(
          (e: HTMLImageElement) => e.complete && e.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const unknown = page
      .locator(".installed-application-card")
      .filter({ hasText: "Unknown app" });
    await expect(unknown.locator("img")).toHaveCount(0);
    await expect(unknown).not.toContainText("https://");
    await page
      .getByPlaceholder("Search apps, containers, images…")
      .fill("nginx stable");
    await page.getByLabel("Status", { exact: true }).selectOption("running");
    await page.getByLabel("Members", { exact: true }).selectOption("multi");
    await expect(page.locator(".installed-application-card")).toHaveCount(1);
    await expect(page.locator(".installed-application-card")).toContainText(
      "Homelab",
    );
    await page.getByRole("button", { name: "Database", exact: true }).click();
    await expect(
      page.getByText("No applications match the current search and filters.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await expect(page.locator(".installed-application-card")).toHaveCount(3);
    await page
      .getByLabel("Sort applications", { exact: true })
      .selectOption("containers");
    await expect(
      page.locator(".installed-application-card").first(),
    ).toContainText("Unknown app");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(c.runtimeErrors).toEqual([]);
  });
test("application metadata errors keep app inventory usable and icon refresh recovers", async ({
  page,
}) => {
  await mockDashboard(page);
  let icon = "https://example.invalid/missing.svg";
  await page.route("https://example.invalid/**", (r) => r.abort());
  await page.route("**/api/v1/applications", (r) =>
    r.fulfill({ json: [{ ...apps[0], name: "Mystery", icon }] }),
  );
  await page.route("**/api/v1/containers", (r) =>
    r.fulfill({ status: 503, json: { error: "Inventory unavailable" } }),
  );
  await page.goto("/");
  await nav(page, "Applications");
  await expect(page.getByText(/Container metadata unavailable/)).toBeVisible();
  await expect(page.locator(".installed-application-card img")).toHaveCount(0);
  icon = "https://cdn.simpleicons.org/grafana";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator(".installed-application-card img")).toHaveAttribute(
    "src",
    /grafana.*\.svg/,
  );
});
const ports = [
  {
    port: 8080,
    proto: "TCP",
    process: "docker-proxy",
    container: "web-a",
    address: "192.0.2.1",
    state: "LISTEN",
  },
  {
    port: 8080,
    proto: "TCP",
    process: "docker-proxy",
    container: "web-a",
    address: "[::]",
    state: "LISTEN",
  },
  {
    port: 53,
    proto: "UDP",
    process: "dns",
    container: "dns",
    address: "0.0.0.0",
    state: "UNCONN",
  },
  {
    port: 443,
    proto: "TCP",
    process: "web",
    container: "Host",
    address: "0.0.0.0",
    state: "LISTEN",
  },
  {
    port: 22,
    proto: "TCP",
    process: "sshd",
    container: "Host",
    address: "127.0.0.1",
    state: "LISTEN",
  },
  {
    port: 5353,
    proto: "UDP",
    process: "—",
    container: "—",
    address: "[::1]",
    state: "UNCONN",
  },
];
for (const width of [320, 1440])
  test(`listening ports group and filter without losing bindings at ${width}px`, async ({
    page,
  }) => {
    const c = await mockDashboard(page);
    await page.setViewportSize({ width, height: 1100 });
    await page.route("**/api/v1/network", async (r) =>
      r.fulfill({
        json: {
          interfaces: [],
          ports,
          topology: {
            gateway: "unavailable",
            host: "owned-test",
            dockerBridge: "unavailable",
            containers: [],
          },
        },
      }),
    );
    await page.goto("/");
    await nav(page, "Network");
    const region = page.getByRole("region", {
      name: "Listening ports",
      exact: true,
    });
    const rows = region.locator("tbody tr:not(.ports-group)");
    await expect(rows).toHaveCount(6);
    await expect(region).toContainText("6 of 6 bindings");
    await region
      .getByRole("button", { name: "Collapse groups", exact: true })
      .click();
    await expect(rows).toHaveCount(0);
    await region
      .getByRole("button", { name: "Expand groups", exact: true })
      .click();
    await expect(rows).toHaveCount(6);
    await region.getByLabel("Source", { exact: true }).selectOption("docker");
    await region.getByLabel("Protocol", { exact: true }).selectOption("TCP");
    await region
      .getByLabel("Filter port numbers", { exact: true })
      .fill("8000-8100");
    await expect(rows).toHaveCount(2);
    await region
      .getByLabel("Bind address", { exact: true })
      .selectOption("specific");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("192.0.2.1");
    await region
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await region.getByLabel("Group by", { exact: true }).selectOption("none");
    await expect(rows).toHaveCount(6);
    expect(await rows.locator("td:first-child").allTextContents()).toEqual([
      "22",
      "53",
      "443",
      "5353",
      "8080",
      "8080",
    ]);
    await region
      .getByLabel("Filter port numbers", { exact: true })
      .fill("9000-8000");
    await expect(region.getByRole("alert")).toBeVisible();
    await region
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await region.getByLabel("Source", { exact: true }).selectOption("unknown");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Unknown");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(c.runtimeErrors).toEqual([]);
  });
for (const width of [320, 1440])
  test(`update console font persists and preserves other preferences at ${width}px`, async ({
    page,
  }) => {
    const c = await mockDashboard(page);
    await page.setViewportSize({ width, height: 1100 });
    await page.route("**/api/v1/updates/jobs/current", (r) =>
      r.fulfill({
        json: {
          id: "font-test",
          action: "refresh",
          status: "succeeded",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          output: "Test output only",
          packages: [],
        },
      }),
    );
    await page.goto("/");
    await nav(page, "Updates");
    const output = page.getByLabel("Update operation output", { exact: true });
    await expect(output).toHaveCSS("font-size", "12px");
    await page
      .getByRole("button", {
        name: "Increase update output font size",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: "Increase update output font size",
        exact: true,
      })
      .click();
    await expect(output).toHaveCSS("font-size", "14px");
    const settings = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("coreops-web-settings") || "{}"),
    );
    expect(settings.updatesOutputFontSize).toBe(14);
    expect(settings.theme).toBe("dark");
    expect(settings.autoRefresh).toBe(false);
    await page.reload();
    await nav(page, "Updates");
    await expect(output).toHaveCSS("font-size", "14px");
    await page
      .getByRole("button", {
        name: "Decrease update output font size",
        exact: true,
      })
      .click();
    await expect(output).toHaveCSS("font-size", "13px");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(c.runtimeErrors).toEqual([]);
  });

test("application refresh keeps an empty active filter explicit", async ({
  page,
}) => {
  await mockDashboard(page);
  let data = apps;
  await page.route("**/api/v1/applications", (r) => r.fulfill({ json: data }));
  await page.goto("/");
  await nav(page, "Applications");
  await page.getByRole("button", { name: "Database", exact: true }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("stopped");
  data = [apps[0]];
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("0 of 1 applications", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Database", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue(
    "stopped",
  );
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.locator(".installed-application-card")).toHaveCount(1);
});
