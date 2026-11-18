import { test, expect, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";

async function settings(page: Page) {
  if ((page.viewportSize()?.width || 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
}
for (const width of [320, 1440])
  test(`create persistent CoreOps account UI at ${width}px`, async ({
    page,
  }) => {
    const control = await mockDashboard(page);
    await page.setViewportSize({ width, height: 1050 });
    let created: Record<string, string> | null = null;
    await page.route("**/api/v1/users", (route) => {
      if (route.request().method() === "POST") {
        created = route.request().postDataJSON();
        return route.fulfill({
          status: 201,
          json: { name: created!.name, role: created!.role },
        });
      }
      return route.fulfill({
        json: [
          { name: "admin", role: "admin" },
          ...(created ? [{ name: created.name, role: created.role }] : []),
        ],
      });
    });
    await page.goto("/");
    await settings(page);
    await page.getByRole("button", { name: /^Users(?: |$)/ }).click();
    await page
      .getByRole("button", { name: "Create user", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Create user",
      exact: true,
    });
    await dialog.getByLabel("Username", { exact: true }).fill("new.viewer");
    await dialog
      .getByLabel("Password", { exact: true })
      .fill("test-only-long-password");
    await dialog
      .getByLabel("Confirm password", { exact: true })
      .fill("different-test-password");
    await dialog
      .getByRole("button", { name: "Create user", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Passwords do not match.",
    );
    expect(created).toBeNull();
    await dialog
      .getByLabel("Confirm password", { exact: true })
      .fill("test-only-long-password");
    await expect(
      dialog.getByRole("combobox", { name: "Role", exact: true }),
    ).toHaveValue("viewer");
    await dialog
      .getByRole("button", { name: "Create user", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText(
      "Created new.viewer (viewer).",
    );
    expect(created).toEqual({
      name: "new.viewer",
      password: "test-only-long-password",
      role: "viewer",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(control.runtimeErrors).toEqual([]);
  });
test("creation errors stay visible and clear password inputs", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.route("**/api/v1/users", (route) =>
    route.fulfill(
      route.request().method() === "POST"
        ? {
            status: 409,
            json: { error: "A user with this name already exists." },
          }
        : { json: [] },
    ),
  );
  await page.goto("/");
  await settings(page);
  await page.getByRole("button", { name: /^Users(?: |$)/ }).click();
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create user", exact: true });
  await dialog.getByLabel("Username", { exact: true }).fill("duplicate");
  for (const name of ["Password", "Confirm password"])
    await dialog
      .getByLabel(name, { exact: true })
      .fill("test-only-long-password");
  await dialog
    .getByRole("button", { name: "Create user", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "A user with this name already exists.",
  );
  await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue("");
});
for (const role of ["viewer", "operator"])
  test(`${role} cannot access user creation or power UI`, async ({ page }) => {
    await mockDashboard(page, "healthy", role);
    await page.goto("/");
    await settings(page);
    await expect(
      page.getByRole("button", { name: /^Users(?: |$)/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "User menu", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Host control center" }),
    ).toHaveCount(0);
  });
