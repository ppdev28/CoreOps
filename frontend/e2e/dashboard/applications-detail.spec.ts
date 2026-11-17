import { expect, test, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";

const app = {
  id: "homelab",
  name: "Homelab",
  description: "Compose project",
  status: "running",
  containers: 2,
  version: `sha256:${"a".repeat(64)}`,
  category: "Web",
  icon: "",
  containerIds: ["abcdef123450", "abcdef123451"],
};
async function openApplication(page: Page) {
  await page.goto("/");
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Applications", exact: true })
    .click();
  await page
    .locator(".installed-application-card")
    .filter({ hasText: "Homelab" })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await expect(page.locator(".application-detail")).toBeVisible();
}

test("application members open the real container inspector and return to their application", async ({
  page,
}) => {
  const control = await mockDashboard(page);
  await page.route("**/api/v1/applications", (route) =>
    route.fulfill({ json: [app] }),
  );
  await openApplication(page);
  const members = page.getByRole("list", {
    name: "Application containers",
    exact: true,
  });
  await expect(members.getByRole("listitem")).toHaveCount(2);
  await expect(members).toContainText("nginx:stable");
  await expect(members).toContainText("postgres:stable");
  await expect(members).not.toContainText("redis");
  await members
    .getByRole("button", {
      name: "Inspect application container nginx",
      exact: true,
    })
    .click();
  await expect(page.locator(".native-container-detail-title")).toContainText(
    "nginx",
  );
  await page
    .getByRole("button", { name: "Network", exact: true })
    .filter({ visible: true })
    .last()
    .click();
  await expect(page.locator(".native-container-detail")).toContainText(
    "Network interfaces",
  );
  await page.locator(".native-container-back").click();
  await expect(members.getByRole("listitem")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .locator(".application-detail")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
  ).toBe(true);
  await members
    .getByRole("button", {
      name: "Inspect application container nginx",
      exact: true,
    })
    .click();
  await expect(page.locator(".native-container-back")).toContainText("Homelab");
  expect(control.runtimeErrors).toEqual([]);
});

test("missing members and inventory failures remain explicit and refresh reconciles them", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.route("**/api/v1/applications", (route) =>
    route.fulfill({
      json: [{ ...app, containerIds: ["abcdef123450", "abcdef999999"] }],
    }),
  );
  await openApplication(page);
  await expect(
    page.getByText("Container unavailable", { exact: true }),
  ).toBeVisible();
  let unavailable = true;
  await page.route("**/api/v1/containers", (route) =>
    unavailable
      ? route.fulfill({
          status: 503,
          json: { error: "Docker temporarily unavailable" },
        })
      : route.fallback(),
  );
  await page
    .getByRole("button", { name: "Refresh application", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Docker temporarily unavailable",
  );
  unavailable = false;
  await page
    .getByRole("button", { name: "Refresh application", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Application containers" }),
  ).toContainText("nginx");
});

test("viewer sees members without privileged inspection or application actions", async ({
  page,
}) => {
  const control = await mockDashboard(page, "healthy", "viewer");
  await page.route("**/api/v1/applications", (route) =>
    route.fulfill({ json: [app] }),
  );
  await openApplication(page);
  await expect(
    page.getByRole("list", { name: "Application containers" }),
  ).toContainText("nginx");
  await expect(
    page.getByRole("button", { name: /Inspect application container/ }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".application-detail")
      .getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  expect(
    control.requests.some((path) => path === "/containers/abcdef123450"),
  ).toBe(false);
});

test("application actions reconcile the observed state instead of guessing success state", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.route("**/api/v1/applications", (route) =>
    route.fulfill({ json: [app] }),
  );
  let calls = 0;
  await page.route("**/api/v1/applications/homelab/stop", (route) => {
    calls++;
    return calls === 1
      ? route.fulfill({
          status: 503,
          json: { error: "Application action refused" },
        })
      : route.fulfill({ json: { ok: true, id: app.id, action: "stop" } });
  });
  await openApplication(page);
  await page
    .locator(".application-detail")
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop application", exact: true })
    .click();
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByRole("alert")).toContainText(
    "Application action refused",
  );
  await page
    .locator(".application-detail")
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop application", exact: true })
    .click();
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page
      .locator(".application-detail")
      .getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .locator(".application-detail")
      .getByRole("button", { name: "Start", exact: true }),
  ).toHaveCount(0);
});
