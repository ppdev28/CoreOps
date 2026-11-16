import { test, expect } from "@playwright/test";
import { mockDashboard } from "./fixtures";
async function setup(page: import("@playwright/test").Page) {
  const control = await mockDashboard(page);
  const state = { unavailable: false, empty: false, ranges: [] as string[] };
  await page.route("**/api/v1/monitoring/history?**", async (route) => {
    const range =
      new URL(route.request().url()).searchParams.get("range") || "24h";
    state.ranges.push(range);
    if (state.unavailable)
      return route.fulfill({
        status: 503,
        json: { error: "Recorded host history is unavailable" },
      });
    const now = Date.now(),
      duration =
        range === "24h" ? 86400000 : range === "6h" ? 21600000 : 3600000;
    const samples = state.empty
      ? []
      : [
          {
            time: now - duration + 600000,
            cpu: 12,
            memory: 40,
            intervalMs: 600000,
          },
          { time: now - 1200000, cpu: 24, memory: 41, intervalMs: 600000 },
          { time: now - 600000, cpu: 32, memory: 42, intervalMs: 600000 },
        ];
    return route.fulfill({
      json: {
        source: "sysstat",
        range,
        from: now - duration,
        to: now,
        samples,
        warnings: [],
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByText("All systems operational", { exact: true }),
  ).toBeVisible();
  return { state, control };
}
test("24h loads retained CPU history immediately and survives navigation and reload", async ({
  page,
}) => {
  const { state, control } = await setup(page);
  const cpu = page.getByRole("radiogroup", { name: "CPU Usage time range" });
  await cpu.getByRole("radio", { name: "24h", exact: true }).click();
  await expect(
    page.locator('.resource-chart[data-range="24h"]').first(),
  ).toHaveAttribute("data-recorded-samples", "3");
  expect(state.ranges).toContain("24h");
  await expect(
    page.getByText("Earlier data unavailable", { exact: true }),
  ).toHaveCount(0);
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Host", exact: true })
    .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Dashboard", exact: true })
    .click();
  await cpu.getByRole("radio", { name: "24h", exact: true }).click();
  await expect(
    page.locator('.resource-chart[data-range="24h"]').first(),
  ).toHaveAttribute("data-recorded-samples", "3");
  await page.reload();
  await cpu.getByRole("radio", { name: "24h", exact: true }).click();
  await expect(
    page.locator('.resource-chart[data-range="24h"]').first(),
  ).toHaveAttribute("data-recorded-samples", "3");
  expect(control.runtimeErrors).toEqual([]);
});
test("archive errors keep a clearly stale history and an empty range never invents samples", async ({
  page,
}) => {
  const { state } = await setup(page);
  await page
    .getByRole("radiogroup", { name: "CPU Usage time range" })
    .getByRole("radio", { name: "24h", exact: true })
    .click();
  const chart = page.locator('.resource-chart[data-range="24h"]');
  await expect(chart).toHaveAttribute("data-recorded-samples", "3");
  state.unavailable = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText(/Recorded history is stale/).first(),
  ).toBeVisible();
  await expect(chart).toHaveAttribute("data-recorded-samples", "3");
  state.unavailable = false;
  state.empty = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(chart).toHaveAttribute("data-recorded-samples", "0");
  await expect(
    page
      .getByText("No archived samples in this range", { exact: true })
      .first(),
  ).toBeVisible();
});
test("Monitoring also requests retained CPU/memory for its selected range", async ({
  page,
}) => {
  const { state } = await setup(page);
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Monitoring", exact: true })
    .click();
  await expect(page.getByText("CPU Usage", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "24h", exact: true }).first().click();
  await expect.poll(() => state.ranges.includes("24h")).toBe(true);
  await expect(
    page.getByText(/Recorded sysstat history \+ live samples/).first(),
  ).toBeVisible();
});
