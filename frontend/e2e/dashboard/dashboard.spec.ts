import { test, expect } from "@playwright/test";
import { mockDashboard } from "./fixtures";

async function screenshotFullMobile(
  page: import("@playwright/test").Page,
  path: string,
) {
  // Overflow is tested at a real phone viewport first; expand height for the export.
  const height = await page
    .locator(".coreops-main")
    .evaluate((el) => el.scrollHeight + 70);
  await page.setViewportSize({ width: 390, height: Math.min(height, 5000) });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path, fullPage: true });
}

test("healthy desktop: monochrome, real table behavior and stable chart range", async ({
  page,
}, info) => {
  const control = await mockDashboard(page);
  await page.clock.install();
  await page.goto("/");
  await expect(
    page.getByText("All systems operational", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Containers overview" }),
  ).toBeVisible();
  await expect(page.locator(".mono-container-row")).toHaveCount(4);
  await expect(page.getByText("No healthcheck", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Healthy health check", { exact: true }),
  ).toHaveCount(1);
  expect(
    await page
      .locator(".app-workspace")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(9, 9, 9)");
  expect(
    await page
      .locator(".mono-card")
      .first()
      .evaluate((el) => getComputedStyle(el).borderRadius),
  ).toBe("26px");
  const ranges = page.getByRole("radiogroup", { name: "CPU Usage time range" });
  await ranges.getByRole("radio", { name: "24h", exact: true }).click();
  await expect(
    ranges.getByRole("radio", { name: "24h", exact: true }),
  ).toHaveAttribute("data-state", "on");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    ranges.getByRole("radio", { name: "24h", exact: true }),
  ).toHaveAttribute("data-state", "on");
  await page
    .getByRole("columnheader", { name: "CPU", exact: true })
    .getByRole("button")
    .click();
  await expect(
    page.getByRole("columnheader", { name: "CPU", exact: true }),
  ).toHaveAttribute("aria-sort", "descending");
  await expect(page.locator(".mono-container-row").first()).toHaveAttribute(
    "data-container-id",
    "abcdef123451",
  );
  await page
    .getByRole("columnheader", { name: "CPU", exact: true })
    .getByRole("button")
    .click();
  await expect(page.locator(".mono-container-row").first()).toHaveAttribute(
    "data-container-id",
    "abcdef123452",
  );
  // Accumulate actual fixture responses at realistic five-second sample intervals.
  for (let i = 0; i < 6; i++) {
    await page.clock.runFor(5000);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeEnabled();
  }
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: info.outputPath("dashboard-healthy-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Select server", exact: true })
    .click();
  await expect(
    page.getByText("Single-host mode. Additional servers are not configured."),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Single-host mode. Additional servers are not configured."),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Inspect nginx", exact: true })
    .click();
  await expect
    .poll(() => control.requests.includes("/containers/abcdef123450"))
    .toBe(true);
  await expect(page.locator("[data-screen=container-detail]")).toBeVisible();
  expect(control.runtimeErrors).toEqual([]);
});

test("two actionable issues stay separate from connectivity", async ({
  page,
}, info) => {
  const control = await mockDashboard(page, "issues");
  await page.goto("/");
  await expect(
    page.getByText("2 issues require attention", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".header-status")).toContainText("Online");
  await expect(
    page.getByText("Unhealthy health check", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".health-issues button")).toHaveCount(2);
  await page.screenshot({
    path: info.outputPath("dashboard-two-issues-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshotFullMobile(
    page,
    info.outputPath("dashboard-two-issues-mobile.png"),
  );
  await page.locator(".health-issues button").first().click();
  await expect(
    page.locator("aside nav button[aria-current='page']"),
  ).toHaveText("Containers");
  expect(control.runtimeErrors).toEqual([]);
});

test("missing samples create chart gaps, stale readings are labelled, empty and offline states", async ({
  page,
}) => {
  const control = await mockDashboard(page);
  await page.goto("/");
  await expect(
    page.getByText("All systems operational", { exact: true }),
  ).toBeVisible();
  control.mode = "gap";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/could not be refreshed/)).toBeVisible();
  await expect(page.locator(".resource-chart").first()).toHaveAttribute(
    "data-missing",
    "1",
  );
  await expect(page.locator(".mono-stale-label")).toHaveCount(2);
  control.mode = "healthy";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("All systems operational", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".resource-chart").first()).toHaveAttribute(
    "data-missing",
    "1",
  );
  await page.clock.install();
  await page.clock.runFor(17000);
  await expect(
    page.getByText("Data is stale · refresh to verify health", { exact: true }),
  ).toBeVisible();
  control.mode = "empty";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("No containers found", { exact: true }),
  ).toBeVisible();
  control.mode = "offline";
  await page.reload();
  await expect(
    page.getByText("Server data unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".header-status")).toContainText("Disconnected");
  expect(control.runtimeErrors).toEqual([]);
});

test("phone layout, navigation drawer and role-aware controls", async ({
  page,
}, info) => {
  const control = await mockDashboard(page, "healthy", "viewer");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByText("All systems operational", { exact: true }),
  ).toBeVisible();
  const overflow = await page
    .locator(
      ".dashboard-page, .mono-card, .dashboard-metrics, .mono-container-row, .coreops-header",
    )
    .evaluateAll((elements) =>
      elements
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.className),
    );
  expect(overflow).toEqual([]);
  expect(
    await page
      .locator(".dashboard-metrics")
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
  ).toBe(2);
  await expect(
    page.getByRole("button", { name: "Create container", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Open terminal", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "View logs", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Inspect nginx", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Host", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await screenshotFullMobile(
    page,
    info.outputPath("dashboard-healthy-mobile.png"),
  );
  expect(control.runtimeErrors).toEqual([]);
});

test("tablet sidebar collapses without changing navigation order", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByText("All systems operational", { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator("aside")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(64);
  expect(await page.locator("aside nav button").allTextContents()).toEqual([
    "Dashboard",
    "Host",
    "Containers",
    "Applications",
    "Services",
    "Storage",
    "Network",
    "Virtual machines",
    "Monitoring",
    "Logs",
    "Terminal",
    "Security",
    "Updates",
    "Settings",
  ]);
  await page.keyboard.press("Control+k");
  await expect(page.locator(".cmd-backdrop")).toBeVisible();
});
