import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { mockDashboard } from "./fixtures";

const messages = [
  ["INFO", "Request accepted"],
  ["WARN", "Retrying upstream"],
  ["ERROR", '{"level":"error","message":"Connection refused","retry":3}'],
  [
    "DEBUG",
    "\u001b[32m\u001b]8;;https://example.com\u001b\\debug worker ready\u001b]8;;\u001b\\\u001b[0m",
  ],
  ["NOTICE", "Backup completed"],
  ["INFO", '<img src=x onerror="window.__logsXss=true">'],
];

async function mockLogs(page: Page, role = "admin") {
  const control = await mockDashboard(page, "healthy", role);
  const state = {
    requests: [] as string[],
    status: 200,
    warnings: [] as string[],
  };
  const reply = async (route: import("@playwright/test").Route) => {
    state.requests.push(route.request().url());
    if (state.status !== 200)
      return route.fulfill({
        status: state.status,
        json: { error: "Log source unavailable" },
      });
    const url = new URL(route.request().url());
    const source = url.pathname.includes("/containers/")
      ? url.pathname.split("/").at(-2)
      : "System";
    return route.fulfill({
      json: {
        entries: messages.map(([level, message], index) => ({
          timestamp: `2026-11-15T12:30:0${index}.123Z`,
          level,
          message,
          source,
          stream: index === 2 ? "stderr" : "stdout",
        })),
        sources: [source],
        warnings: state.warnings,
        updatedAt: "2026-11-15T12:30:06Z",
      },
    });
  };
  await page.route("**/api/v1/logs*", reply);
  await page.route("**/api/v1/containers/*/logs?*", reply);
  return { control, state };
}

async function navigate(page: Page, name = "Logs") {
  await page.goto("/");
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator(".sidebar-desktop, [style*='z-index: 101']")
    .getByRole("button", { name, exact: true })
    .filter({ visible: true })
    .click();
}

test("Dozzle-style source sidebar, tabs and comparison use container-specific logs", async ({
  page,
}, info) => {
  const { control, state } = await mockLogs(page);
  await navigate(page);
  await expect(
    page.getByRole("region", { name: "All logs logs", exact: true }),
  ).toContainText("Request accepted");
  await page
    .getByRole("button", { name: "Open logs for nginx", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "nginx", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() =>
      state.requests.some((url) =>
        url.endsWith("/containers/abcdef123450/logs?tail=500"),
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Compare logs for postgres", exact: true })
    .click();
  await expect(page.locator(".logs-pane")).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "postgres logs", exact: true }),
  ).toContainText("Retrying upstream");
  await page.screenshot({
    path: info.outputPath("logs-desktop-comparison.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Close postgres logs tab", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "postgres", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "nginx logs", exact: true }),
  ).toBeVisible();
  expect(control.runtimeErrors).toEqual([]);
});

test("logs search, case, exclude, levels and structured JSON are safe and functional", async ({
  page,
}) => {
  const { control } = await mockLogs(page);
  await navigate(page);
  const lines = page
    .getByRole("list", { name: "Log lines" })
    .getByRole("listitem");
  await expect(lines).toHaveCount(6);
  await page.keyboard.press("Control+f");
  await expect(
    page.getByRole("textbox", { name: "Find in logs", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Expand JSON line 3", exact: true })
    .click();
  await expect(page.locator(".logs-json-detail")).toContainText('"retry": 3');
  await expect(page.locator(".logs-pane img")).toHaveCount(0);
  expect(await page.evaluate(() => "__logsXss" in window)).toBe(false);
  await expect(
    page.getByText("debug worker ready", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Find in logs", exact: true })
    .fill("request");
  await expect(lines).toHaveCount(1);
  await page.getByRole("button", { name: "Match case", exact: true }).click();
  await expect(
    page.getByText("No matching log lines", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Match case", exact: true }).click();
  await page
    .getByRole("button", { name: "Exclude matching log lines", exact: true })
    .click();
  await expect(lines).toHaveCount(5);
  await page
    .getByRole("button", { name: "Clear log search", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle ERROR logs", exact: true })
    .click();
  await expect(page.locator('[data-log-level="ERROR"]')).toHaveCount(0);
  await expect(lines).toHaveCount(5);
  await page
    .getByRole("button", { name: "Log display settings", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Line numbers", exact: true })
    .check();
  await expect(page.locator(".logs-line-number")).toHaveCount(5);
  await page
    .getByRole("checkbox", { name: "Timestamps (UTC)", exact: true })
    .uncheck();
  await expect(page.locator(".logs-timestamp")).toHaveCount(0);
  expect(control.runtimeErrors).toEqual([]);
});

test("pause freezes log reads, resume polls and display stays manual when paused", async ({
  page,
}) => {
  const { state } = await mockLogs(page);
  await navigate(page);
  await expect(
    page.getByText("Request accepted", { exact: true }),
  ).toBeVisible();
  const initial = state.requests.length;
  await page.waitForTimeout(2200);
  expect(state.requests).toHaveLength(initial);
  await page
    .getByRole("button", { name: "Resume log updates", exact: true })
    .click();
  await expect.poll(() => state.requests.length).toBeGreaterThan(initial + 1);
  await page
    .getByRole("button", { name: "Pause log updates", exact: true })
    .click();
  const paused = state.requests.length;
  await page.waitForTimeout(2300);
  expect(state.requests).toHaveLength(paused);
  await page
    .getByRole("button", { name: "Refresh all log panes", exact: true })
    .click();
  await expect.poll(() => state.requests.length).toBeGreaterThan(paused);
});

test("downloads and copies only the displayed filtered logs", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockLogs(page);
  await navigate(page);
  await page
    .getByRole("textbox", { name: "Find in logs", exact: true })
    .fill("Retrying upstream");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Copy All logs logs", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("WARN System Retrying upstream");
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download All logs logs", exact: true })
    .click();
  const download = await pending;
  const path = await download.path();
  const contents = await readFile(path!, "utf8");
  expect(contents).toContain("Retrying upstream");
  expect(contents).not.toContain("Request accepted");
  expect(download.suggestedFilename()).toMatch(/\.log$/);
});

test("failed refresh preserves last data, source warnings and operator permission", async ({
  page,
}) => {
  const { state, control } = await mockLogs(page, "operator");
  state.warnings = ["System journal unavailable"];
  await navigate(page);
  await expect(
    page.getByText("Request accepted", { exact: true }),
  ).toBeVisible();
  await page.getByText("1 source warning", { exact: true }).click();
  await expect(
    page.getByText("System journal unavailable", { exact: true }),
  ).toBeVisible();
  state.status = 502;
  await page
    .getByRole("button", { name: "Refresh All logs logs", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Showing the last successful snapshot.",
  );
  await expect(
    page.getByText("Request accepted", { exact: true }),
  ).toBeVisible();
  expect(control.runtimeErrors).toEqual([]);
});

test("mobile source picker, focus and comparison fit 320px", async ({
  page,
}, info) => {
  const { control } = await mockLogs(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await navigate(page);
  await page
    .getByRole("button", { name: "Select log source", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Find containers", exact: true })
    .fill("nginx");
  await page
    .getByRole("button", { name: "Open logs for nginx", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "nginx logs", exact: true }),
  ).toContainText("Request accepted");
  expect(
    await page
      .locator(".logs-workspace")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("logs-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Focus log viewer", exact: true })
    .click();
  await expect(page.locator(".logs-workspace")).toHaveClass(/is-focused/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".logs-workspace")).not.toHaveClass(/is-focused/);
  expect(control.runtimeErrors).toEqual([]);
});

test("viewer never requests privileged logs", async ({ page }) => {
  const { state } = await mockLogs(page, "viewer");
  await navigate(page);
  await expect(
    page
      .getByText("Operator access required", { exact: true })
      .filter({ visible: true })
      .last(),
  ).toBeVisible();
  expect(state.requests).toEqual([]);
});

test("Containers menu and inspect link open the selected container logs", async ({
  page,
}) => {
  const { state, control } = await mockLogs(page);
  await navigate(page, "Containers");
  await page
    .getByRole("button", { name: "Actions for nginx", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .locator(".anim-slide-down")
    .getByRole("button", { name: "Logs", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "nginx", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() =>
      state.requests.some((url) =>
        url.includes("/containers/abcdef123450/logs"),
      ),
    )
    .toBe(true);
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Containers", exact: true })
    .click();
  await page
    .locator(".containers-desktop-table tr")
    .filter({ hasText: "nginx" })
    .click();
  await page
    .locator(".native-container-actions")
    .getByRole("button", { name: "Logs", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "nginx", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(control.runtimeErrors).toEqual([]);
});
