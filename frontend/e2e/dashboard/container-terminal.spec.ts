import { expect, test } from "@playwright/test";
import { mockDashboard } from "./fixtures";

test("detail opens a container shell and preserves the host shell independently", async ({
  page,
}) => {
  const control = await mockDashboard(page);
  await page.goto("/");
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await expect(
    page.locator('.pty-emulator[data-state="connected"]'),
  ).toBeVisible();
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Dashboard", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Inspect nginx", exact: true })
    .click();
  await page
    .locator(".native-container-actions")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "nginx", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Container terminal: nginx")).toHaveAttribute(
    "data-state",
    "connected",
  );
  await page.keyboard.type("echo container");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => control.terminalInputs.join(""))
    .toContain("echo container\r");
  expect(
    control.terminalConnections.map((url) => new URL(url).pathname),
  ).toEqual([
    "/api/v1/terminal/session",
    "/api/v1/containers/abcdef123450/terminal",
  ]);
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Dashboard", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Inspect nginx", exact: true })
    .click();
  await page
    .locator(".native-container-actions")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  expect(control.terminalConnections).toHaveLength(2);
  await page.getByRole("button", { name: "Close nginx", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("may continue");
  await page
    .getByRole("button", { name: "Disconnect terminal", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Shell 1", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(control.runtimeErrors).toEqual([]);
});
test("opening from detail first starts only the container terminal and surfaces stale state", async ({
  page,
}) => {
  const control = await mockDashboard(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Inspect nginx", exact: true })
    .click();
  await page.route("**/api/v1/containers/abcdef123450/terminal", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "Container must be running" },
    }),
  );
  await page
    .locator(".native-container-actions")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("must be running");
  expect(control.terminalConnections).toHaveLength(0);
});
test("operator cannot open a privileged container terminal", async ({
  page,
}) => {
  await mockDashboard(page, "healthy", "operator");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Inspect nginx", exact: true })
    .click();
  await expect(page.locator(".native-container-detail-title")).toBeVisible();
  await expect(
    page
      .locator(".native-container-actions")
      .getByRole("button", { name: "Terminal", exact: true }),
  ).toHaveCount(0);
});
