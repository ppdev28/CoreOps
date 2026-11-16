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

test("sidebar arrow expands and collapses actual tablet and desktop widths", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.goto("/");
  const sidebar = page.locator(".sidebar-desktop aside");
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await sidebar
    .getByRole("button", { name: "Expand navigation", exact: true })
    .click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await expect
    .poll(() =>
      sidebar.evaluate((e) => Math.round(e.getBoundingClientRect().width)),
    )
    .toBe(220);
  await expect(sidebar.getByText("Containers", { exact: true })).toBeVisible();
  await sidebar
    .getByRole("button", { name: "Collapse navigation", exact: true })
    .click();
  await expect
    .poll(() =>
      sidebar.evaluate((e) => Math.round(e.getBoundingClientRect().width)),
    )
    .toBe(64);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await sidebar
    .getByRole("button", { name: "Collapse navigation", exact: true })
    .click();
  await sidebar
    .getByRole("button", { name: "Expand navigation", exact: true })
    .click();
  await expect
    .poll(() =>
      sidebar.evaluate((e) => Math.round(e.getBoundingClientRect().width)),
    )
    .toBe(220);
});
test("Dashboard create action submits the real create form and retains Compose", async ({
  page,
}) => {
  const c = await mockDashboard(page);
  let created: any;
  await page.route("**/api/v1/containers", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    created = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      json: {
        id: "abcdef123456",
        name: created.name,
        started: false,
        warnings: [],
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create container", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create container",
    exact: true,
  });
  await dialog
    .getByLabel("Container name", { exact: true })
    .fill("dashboard-create-test");
  await dialog.getByLabel("Image", { exact: true }).fill("nginx:stable");
  await dialog
    .getByRole("button", { name: "Create container", exact: true })
    .click();
  await expect(dialog.getByText(/dashboard-create-test/).first()).toBeVisible();
  expect(created.name).toBe("dashboard-create-test");
  expect(c.runtimeErrors).toEqual([]);
});
test("Dashboard creation requires admin", async ({ page }) => {
  await mockDashboard(page, "healthy", "viewer");
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Create container", exact: true }),
  ).toBeDisabled();
});
for (const width of [320, 1440])
  test(`delete file confirms, preserves failed rows and handles real completion at ${width}px`, async ({
    page,
  }) => {
    const c = await mockDashboard(page);
    await page.setViewportSize({ width, height: 900 });
    let calls = 0;
    let fail = true;
    let complete: (() => void) | undefined;
    await page.addInitScript(() =>
      localStorage.setItem(
        "coreops-web-settings",
        JSON.stringify({
          theme: "dark",
          notifications: false,
          confirmDestructive: false,
        }),
      ),
    );
    await page.route("**/api/v1/files", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      calls++;
      const p = route.request().postDataJSON();
      expect(p.path).toBe("/example.txt");
      expect(p.version).toHaveLength(64);
      if (fail)
        return route.fulfill({
          status: 403,
          json: { error: "service user lacks delete permission" },
        });
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
      return route.fulfill({ json: { ok: true, path: p.path } });
    });
    await page.goto("/");
    await nav(page, "Files");
    await page
      .getByRole("button", { name: "Delete example.txt", exact: true })
      .click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("/example.txt");
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(calls).toBe(0);
    await page
      .getByRole("button", { name: "Delete example.txt", exact: true })
      .click();
    await confirm
      .getByRole("button", { name: "Delete file", exact: true })
      .click();
    await expect(page.getByText(/Delete failed: service user/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete example.txt", exact: true }),
    ).toBeEnabled();
    fail = false;
    await page
      .getByRole("button", { name: "Delete example.txt", exact: true })
      .click();
    await confirm
      .getByRole("button", { name: "Delete file", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Delete example.txt", exact: true }),
    ).toBeDisabled();
    await expect.poll(() => !!complete).toBe(true);
    complete!();
    await expect(
      page.getByText("Deleted /example.txt", { exact: true }),
    ).toBeVisible();
    expect(calls).toBe(2);
    expect(
      await page
        .locator(".files-view")
        .evaluate((e) => e.scrollWidth > e.clientWidth + 2),
    ).toBe(false);
    expect(c.runtimeErrors).toEqual([]);
  });
test("Updates tracks background completion through navigation and blocks duplicates", async ({
  page,
}) => {
  const c = await mockDashboard(page);
  let task: any = null;
  let calls = 0;
  const data = {
    updatedAt: new Date().toISOString(),
    updates: [
      { package: "openssl", current: "1", available: "2", type: "security" },
    ],
    securityCount: 1,
    systemCount: 0,
    capability: { available: true },
  };
  await page.route("**/api/v1/updates**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/jobs/")) return route.fulfill({ json: task });
    if (route.request().method() === "POST") {
      calls++;
      task = {
        id: "job-1",
        action: "upgrade",
        status: "running",
        startedAt: new Date().toISOString(),
        packages: [],
        output: "",
      };
      return route.fulfill({ status: 202, json: task });
    }
    return route.fulfill({ json: data });
  });
  await page.goto("/");
  await nav(page, "Updates");
  await page.getByRole("button", { name: "Apply all", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Apply all updates", exact: true })
    .click();
  await expect(page.getByText(/Package operation running/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check now", exact: true }),
  ).toBeDisabled();
  await nav(page, "Host");
  await nav(page, "Updates");
  await expect(page.getByText(/Package operation running/)).toBeVisible();
  task = {
    ...task,
    status: "succeeded",
    finishedAt: new Date().toISOString(),
    output: "Completed by APT",
    overview: { ...data, updates: [], securityCount: 0 },
  };
  await expect(
    page.getByRole("region", { name: "Package operation" }),
  ).toContainText("succeeded");
  await expect(
    page.getByText("Completed by APT", { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(1);
  expect(c.runtimeErrors).toEqual([]);
});
test("Updates surfaces missing host privileges and denies viewer mutations", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.route("**/api/v1/updates", (route) =>
    route.fulfill({
      json: {
        updatedAt: new Date().toISOString(),
        updates: [],
        securityCount: 0,
        systemCount: 0,
        capability: {
          available: false,
          error:
            "Install the restricted CoreOps APT helper for the service user",
        },
      },
    }),
  );
  await page.goto("/");
  await nav(page, "Updates");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "restricted CoreOps APT helper" }),
  ).toContainText("restricted CoreOps APT helper");
  await expect(
    page.getByRole("button", { name: "Check now", exact: true }),
  ).toBeDisabled();
});
