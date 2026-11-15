import { expect, test, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";

const id = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

async function deletionFixture(page: Page, role = "admin") {
  const control = await mockDashboard(page, "healthy", role);
  const fixture = { removed: false, deletes: 0, listRequests: 0 };
  await page.route("**/api/v1/containers", (route) => {
    fixture.listRequests++;
    return route.fulfill({
      json: [
        ...(fixture.removed
          ? []
          : [
              {
                id,
                name: "disposable",
                image: "nginx:stable",
                state: "exited",
                status: "Exited (0)",
                createdAt: 1800000000,
                ports: [],
                networks: ["bridge"],
              },
            ]),
        {
          id: "123456abcdef",
          name: "keep-running",
          image: "nginx:stable",
          state: "running",
          status: "Up 1 hour",
          createdAt: 1800000000,
          ports: [],
          networks: ["bridge"],
        },
      ],
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "coreops-web-settings",
      JSON.stringify({
        theme: "dark",
        autoRefresh: false,
        confirmDestructive: false,
        notifications: false,
      }),
    );
  });
  return { control, fixture };
}

async function navigateContainers(page: Page) {
  await page.goto("/");
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Containers", exact: true })
    .filter({ visible: true })
    .click();
}

async function requestDelete(page: Page, name = "disposable") {
  await page
    .getByRole("button", { name: `Actions for ${name}`, exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
}

test("deletion always confirms, cancels safely and waits for Docker before removing the row", async ({
  page,
}) => {
  const { control, fixture } = await deletionFixture(page);
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route(`**/api/v1/containers/${id}`, async (route) => {
    expect(route.request().method()).toBe("DELETE");
    fixture.deletes++;
    await held;
    fixture.removed = true;
    return route.fulfill({ json: { ok: true, id } });
  });
  await navigateContainers(page);
  const row = page
    .locator(".containers-desktop-table tr")
    .filter({ hasText: "disposable" });
  await row.getByRole("checkbox").check();
  await requestDelete(page);
  const confirmation = page.getByRole("alertdialog", {
    name: 'Delete container "disposable"?',
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(
    "Volumes and images will not be deleted.",
  );
  expect(fixture.deletes).toBe(0);
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(fixture.deletes).toBe(0);
  await expect(row).toBeVisible();
  await requestDelete(page);
  await confirmation
    .getByRole("button", { name: "Delete container", exact: true })
    .click();
  await expect.poll(() => fixture.deletes).toBe(1);
  await expect(row.getByText("Deleting…", { exact: true })).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Actions for disposable" }),
  ).toHaveCount(0);
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('[data-screen="containers"]')).toBeVisible();
  const requestsBeforeRefresh = fixture.listRequests;
  finish();
  await expect(row).toHaveCount(0);
  await expect
    .poll(() => fixture.listRequests)
    .toBeGreaterThan(requestsBeforeRefresh);
  await expect(
    page.getByRole("button", { name: "Stop 1", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("button", { name: "Actions for keep-running", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  expect(fixture.deletes).toBe(1);
  expect(control.runtimeErrors).toEqual([]);
});

for (const failure of [
  {
    status: 409,
    body: { error: "Stop it and refresh before trying again." },
    message: "Stop it and refresh before trying again.",
  },
  {
    status: 403,
    body: { error: "your role does not allow this action" },
    message: "your role does not allow this action",
  },
  {
    status: 200,
    body: { ok: true, id: "incorrect-container" },
    message: "Deletion could not be confirmed",
  },
])
  test(`deletion failure ${failure.status} keeps the container and reports the actual outcome`, async ({
    page,
  }) => {
    const { control, fixture } = await deletionFixture(page);
    await page.route(`**/api/v1/containers/${id}`, async (route) => {
      fixture.deletes++;
      return route.fulfill({ status: failure.status, json: failure.body });
    });
    await navigateContainers(page);
    await requestDelete(page);
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete container", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(failure.message);
    await expect(
      page
        .getByRole("button", { name: "Actions for disposable", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Deleted disposable", { exact: true }),
    ).toHaveCount(0);
    expect(fixture.deletes).toBe(1);
    expect(control.runtimeErrors).toEqual([]);
  });

test("running containers need an explicit stop before deletion", async ({
  page,
}) => {
  const { control } = await deletionFixture(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE") requests.push(request.url());
  });
  await navigateContainers(page);
  await requestDelete(page, "keep-running");
  await expect(page.getByRole("alert")).toContainText(
    "Stop keep-running and refresh its state before deleting it.",
  );
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(control.runtimeErrors).toEqual([]);
});

test("mobile deletion stays within the screen and reconciles the card", async ({
  page,
}) => {
  const { control, fixture } = await deletionFixture(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route(`**/api/v1/containers/${id}`, async (route) => {
    expect(route.request().method()).toBe("DELETE");
    fixture.deletes++;
    fixture.removed = true;
    return route.fulfill({ json: { ok: true, id } });
  });
  await navigateContainers(page);
  await requestDelete(page);
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  expect(
    await confirmation.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await confirmation
    .getByRole("button", { name: "Delete container", exact: true })
    .click();
  await expect(
    page.locator(".containers-mobile-card").filter({ hasText: "disposable" }),
  ).toHaveCount(0);
  expect(fixture.deletes).toBe(1);
  expect(control.runtimeErrors).toEqual([]);
});

for (const role of ["viewer", "operator"])
  test(`${role} cannot access container deletion`, async ({ page }) => {
    const { control } = await deletionFixture(page, role);
    await navigateContainers(page);
    await page
      .getByRole("button", { name: "Actions for disposable", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toHaveCount(0);
    expect(control.runtimeErrors).toEqual([]);
  });
