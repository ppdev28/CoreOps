import { expect, test, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";

async function openContainers(page: Page) {
  await page.goto("/");
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Containers", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.locator('[data-screen="containers"]')).toBeVisible();
}

test("container module reports unavailable restart counts and retains action flow", async ({
  page,
}) => {
  const control = await mockDashboard(page);
  let actions = 0;
  await page.route("**/api/v1/containers/abcdef123450/restart", (route) => {
    actions++;
    return route.fulfill({ json: { ok: true, id: "abcdef123450" } });
  });
  await openContainers(page);
  const row = page.getByRole("row").filter({ hasText: "nginx" });
  await expect(row.getByRole("cell").nth(9)).toHaveText("—");
  const initialLists = control.requests.filter(
    (path) => path === "/containers",
  ).length;
  await row.getByRole("button").click();
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await page
    .getByRole("button", { name: "Restart container", exact: true })
    .click();
  await expect.poll(() => actions).toBe(1);
  await expect
    .poll(
      () => control.requests.filter((path) => path === "/containers").length,
    )
    .toBeGreaterThan(initialLists);
  expect(control.runtimeErrors).toEqual([]);
});

test("container detail handles valid null collections from the API", async ({
  page,
}) => {
  const control = await mockDashboard(page);
  await page.route("**/api/v1/containers/abcdef123450", (route) =>
    route.fulfill({
      json: {
        id: "abcdef123450",
        name: "nginx",
        image: "nginx:stable",
        state: "running",
        created: "2026-11-01T00:00:00Z",
        config: { env: null, cmd: null, entrypoint: null, workingDir: "" },
        restartPolicy: "no",
        mounts: null,
        networks: null,
        ports: null,
        labels: null,
      },
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Inspect nginx", exact: true })
    .click();
  await expect(page.locator('[data-screen="container-detail"]')).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "nginx", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Environment", exact: true }).click();
  await expect(
    page.getByText("No environment variables.", { exact: true }),
  ).toBeVisible();
  expect(control.runtimeErrors).toEqual([]);
});

test("shared API transport preserves role errors and expires the single session store", async ({
  page,
}) => {
  await mockDashboard(page);
  let status = 403;
  await page.route("**/api/v1/containers", (route) =>
    route.fulfill({
      status,
      json: {
        error:
          status === 403
            ? "your role does not allow this action"
            : "authentication required",
      },
    }),
  );
  await openContainers(page);
  await expect(
    page.getByText("your role does not allow this action", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("coreops.session")),
  ).not.toBeNull();
  status = 401;
  await page.getByRole("button", { name: /retry/i }).click();
  await expect(page.locator(".coreops-login")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("coreops.session")),
  ).toBeNull();
});
