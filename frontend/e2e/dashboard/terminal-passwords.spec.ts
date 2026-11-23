import { test, expect, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";
const secret = "test-only-saved-password-é";
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
for (const width of [320, 1440])
  test(`save, paste without Enter and forget password at ${width}px`, async ({
    page,
  }) => {
    const c = await mockDashboard(page);
    await page.setViewportSize({ width, height: 1000 });
    let stored: string | null = null;
    let revealed = 0;
    await page.route("**/api/v1/terminal/passwords/**", (r) => {
      if (r.request().url().endsWith("/reveal")) {
        revealed++;
        return r.fulfill({ json: { password: stored } });
      }
      if (r.request().method() === "POST") {
        stored = r.request().postDataJSON().password;
        return r.fulfill({ json: { saved: true } });
      }
      if (r.request().method() === "DELETE") {
        stored = null;
        return r.fulfill({ json: { saved: false } });
      }
      return r.fulfill({ json: { saved: !!stored } });
    });
    await page.goto("/");
    await nav(page, "Terminal");
    await expect(
      page.locator('.pty-emulator[data-state="connected"]'),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Save terminal password", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Terminal password",
      exact: true,
    });
    await dialog.getByLabel("Password", { exact: true }).fill(secret);
    await dialog
      .getByRole("button", { name: "Save password", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(stored).toBe(secret);
    expect(c.terminalInputs.join("")).toBe("");
    expect(revealed).toBe(0);
    await page
      .getByRole("button", { name: "Paste saved password", exact: true })
      .click();
    await expect.poll(() => c.terminalInputs.join("")).toBe(secret);
    expect(c.terminalInputs.join("")).not.toContain("\r");
    expect(c.terminalInputs.join("")).not.toContain("\n");
    expect(revealed).toBe(1);
    expect(
      await page.evaluate(() => JSON.stringify({ ...localStorage })),
    ).not.toContain(secret);
    expect(
      await page.evaluate(() => JSON.stringify({ ...sessionStorage })),
    ).not.toContain(secret);
    await page.reload();
    await nav(page, "Terminal");
    await expect(
      page.getByRole("button", { name: "Paste saved password", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Manage terminal password", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Replace saved password", { exact: true }),
    ).toHaveValue("");
    await dialog
      .getByRole("button", { name: "Forget password", exact: true })
      .click();
    await expect(dialog).toContainText("No password is saved for this target.");
    expect(stored).toBeNull();
    await dialog
      .getByRole("button", { name: "Close terminal password", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(c.runtimeErrors).toEqual([]);
  });
test("password arriving after a tab change is never sent to either shell", async ({
  page,
}) => {
  const c = await mockDashboard(page);
  let release: () => void = () => {};
  let started = false;
  await page.route("**/api/v1/terminal/passwords/**", async (r) => {
    if (r.request().url().endsWith("/reveal")) {
      started = true;
      await new Promise<void>((resolve) => (release = resolve));
      await r.fulfill({ json: { password: secret } }).catch(() => {});
      return;
    }
    return r.fulfill({ json: { saved: true } });
  });
  await page.goto("/");
  await nav(page, "Terminal");
  await expect(
    page.locator('.pty-emulator[data-state="connected"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Paste saved password", exact: true })
    .click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Shell 2", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  release();
  await expect(
    page.locator('.pty-emulator[data-state="connected"]'),
  ).toHaveCount(2);
  expect(c.terminalInputs.join("")).toBe("");
  expect(c.runtimeErrors).toEqual([]);
});
test("unsafe stored content and persistence errors never paste or remain in inputs", async ({
  page,
}) => {
  const c = await mockDashboard(page);
  await page.route("**/api/v1/terminal/passwords/**", (r) => {
    if (r.request().url().endsWith("/reveal"))
      return r.fulfill({ json: { password: "password\ncommand" } });
    if (r.request().method() === "POST")
      return r.fulfill({
        status: 503,
        json: { error: "Encrypted storage is unavailable" },
      });
    return r.fulfill({ json: { saved: true } });
  });
  await page.goto("/");
  await nav(page, "Terminal");
  await expect(
    page.locator('.pty-emulator[data-state="connected"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Paste saved password", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("not safe to paste");
  expect(c.terminalInputs.join("")).toBe("");
  await page
    .getByRole("button", { name: "Manage terminal password", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Terminal password",
    exact: true,
  });
  await dialog
    .getByLabel("Replace saved password", { exact: true })
    .fill(secret);
  await dialog
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Encrypted storage is unavailable",
  );
  await expect(
    dialog.getByLabel("Replace saved password", { exact: true }),
  ).toHaveValue("");
  expect(c.terminalInputs.join("")).toBe("");
});
test("outdated API explains missing storage without changing the terminal connection", async ({
  page,
}) => {
  const c = await mockDashboard(page);
  await page.route("**/api/v1/terminal/passwords/**", (r) =>
    r.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.goto("/");
  await nav(page, "Terminal");
  await expect(
    page.locator('.pty-emulator[data-state="connected"]'),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Rebuild/restart");
  expect(c.terminalMessages.filter((m) => m.type === "auth")).toHaveLength(1);
});
test("viewer never requests terminal credentials", async ({ page }) => {
  await mockDashboard(page, "healthy", "viewer");
  let calls = 0;
  await page.route("**/api/v1/terminal/passwords/**", (r) => {
    calls++;
    return r.fulfill({ json: { saved: false } });
  });
  await page.goto("/");
  await nav(page, "Terminal");
  await expect(
    page.getByRole("button", { name: "Save terminal password", exact: true }),
  ).toHaveCount(0);
  expect(calls).toBe(0);
});
