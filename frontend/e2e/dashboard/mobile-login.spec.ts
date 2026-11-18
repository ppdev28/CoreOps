import { test, expect } from "@playwright/test";
import { mockDashboard } from "./fixtures";

test("native login uses selected server, normalizes API suffix and binds session", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.addInitScript(() => {
    localStorage.removeItem("coreops.session");
    (window as any).CapacitorCustomPlatform = { name: "android" };
  });
  let loginURL = "";
  await page.route("**/api/v1/auth/login", (route) => {
    loginURL = route.request().url();
    return route.fulfill({
      json: {
        token: "login-test-only",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        user: { name: "mobile", role: "viewer" },
      },
    });
  });
  await page.goto("/");
  await page
    .getByLabel(/Server address/)
    .fill("http://192.0.2.44:5173/api/v1/");
  await page.getByLabel("Username", { exact: true }).fill("mobile");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-only-long-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect
    .poll(() => loginURL)
    .toBe("http://192.0.2.44:5173/api/v1/auth/login");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("coreops.session") || "null")
            ?.apiBase,
      ),
    )
    .toBe("http://192.0.2.44:5173/api/v1");
  const result = await page.evaluate(async () => {
    const path = "/src/shared/platform/session.ts";
    const session = await import(path);
    session.setServerUrl("http://192.0.2.55:5173");
    return {
      session: session.getSession(),
      stored: localStorage.getItem("coreops.session"),
    };
  });
  expect(result).toEqual({ session: null, stored: null });
});
test("mobile login reports unreachable loopback-only API with the proxy hint", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.addInitScript(() => {
    localStorage.removeItem("coreops.session");
    (window as any).CapacitorCustomPlatform = { name: "android" };
  });
  await page.route("**/api/v1/auth/login", (route) =>
    route.abort("connectionrefused"),
  );
  await page.goto("/");
  await page.getByLabel(/Server address/).fill("http://192.0.2.44:8082");
  await page.getByLabel("Username", { exact: true }).fill("mobile");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-only-long-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(":5173");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeEnabled();
});
