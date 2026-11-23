import { test, expect, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";

const service = {
  id: "alsa-restore.service",
  name: "alsa-restore.service",
  description: "Restore sound state",
  status: "active",
  enabled: true,
  cpu: "—",
  memory: "—",
  uptime: "1h",
  management: { available: true },
};
async function openServices(page: Page) {
  await page.goto("/");
  if ((page.viewportSize()?.width || 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Services", exact: true })
    .click();
  await expect(
    page.getByText("alsa-restore.service", { exact: true }),
  ).toBeVisible();
}

for (const width of [320, 1440])
  test(`service stop confirms once and reconciles at ${width}px`, async ({
    page,
  }) => {
    await mockDashboard(page, "healthy", "operator");
    await page.setViewportSize({ width, height: 1000 });
    let stopped = false,
      posts = 0;
    await page.route("**/api/v1/services", (route) =>
      route.fulfill({
        json: [{ ...service, status: stopped ? "inactive" : "active" }],
      }),
    );
    await page.route(
      "**/api/v1/services/alsa-restore.service/stop",
      (route) => {
        posts++;
        stopped = true;
        return route.fulfill({
          json: { ok: true, name: service.name, action: "stop" },
        });
      },
    );
    await openServices(page);
    await page
      .getByRole("button", { name: "Stop alsa-restore.service", exact: true })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByText("Stop alsa-restore.service?", { exact: true }),
    ).toBeVisible();
    expect(posts).toBe(0);
    await dialog.getByRole("button", { name: "Stop", exact: true }).click();
    await expect.poll(() => posts).toBe(1);
    await expect(
      page.getByRole("button", {
        name: "Start alsa-restore.service",
        exact: true,
      }),
    ).toBeVisible();
    expect(posts).toBe(1);
  });

test("missing helper permissions disable actions and explain setup", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.route("**/api/v1/services", (route) =>
    route.fulfill({
      json: [
        {
          ...service,
          management: {
            available: false,
            reason: "Run coreops-setup --add services as administrator",
          },
        },
      ],
    }),
  );
  await openServices(page);
  await expect(page.getByRole("alert")).toContainText(
    "coreops-setup --add services",
  );
  await expect(
    page.getByRole("button", {
      name: "Stop alsa-restore.service",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Restart alsa-restore.service",
      exact: true,
    }),
  ).toBeDisabled();
});

test("viewer sees services without privileged actions", async ({ page }) => {
  await mockDashboard(page, "healthy", "viewer");
  await page.route("**/api/v1/services", (route) =>
    route.fulfill({ json: [service] }),
  );
  await openServices(page);
  await expect(
    page.getByRole("button", {
      name: "Stop alsa-restore.service",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("Read only", { exact: true })).toBeVisible();
});

test("uncertain service failure persists with notifications off and does not retry", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "coreops-web-settings",
      JSON.stringify({ notifications: false, autoRefresh: false }),
    ),
  );
  await mockDashboard(page);
  let posts = 0;
  await page.route("**/api/v1/services", (route) =>
    route.fulfill({ json: [service] }),
  );
  await page.route(
    "**/api/v1/services/alsa-restore.service/restart",
    (route) => {
      posts++;
      return route.fulfill({
        status: 503,
        json: {
          error:
            "Service outcome is unconfirmed; refresh the unit before another request",
        },
      });
    },
  );
  await openServices(page);
  await page
    .getByRole("button", { name: "Restart alsa-restore.service", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("outcome is unconfirmed");
  await page.waitForTimeout(300);
  expect(posts).toBe(1);
});
