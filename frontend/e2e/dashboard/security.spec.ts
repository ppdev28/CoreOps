import { test, expect, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";
const id = "a".repeat(64);
function evidence() {
  return {
    updatedAt: new Date().toISOString(),
    checks: [
      {
        id: "firewall",
        label: "Firewall",
        ok: null,
        status: "unknown",
        detail: "Permission denied reading live UFW state",
      },
      {
        id: "auto-updates",
        label: "Auto security updates",
        ok: false,
        status: "attention",
        detail: "Timer disabled",
      },
    ],
    sessions: [
      {
        id,
        user: "operator",
        uid: 1000,
        from: "192.0.2.55",
        since: "",
        method: "SSH",
        pid: 12345,
        parentPid: 12300,
        terminal: "pts/4",
        name: "operator · pts/4",
        process: "sshd",
        verified: true,
        canTerminate: true,
      },
    ],
    firewallActive: null,
    firewallRules: [],
    firewallVersion: "",
    events: [],
    sources: {
      sessions: { state: "ok" },
      ufw: { state: "permission_denied", detail: "Needs restricted helper" },
      events: {
        state: "permission_denied",
        detail: "System journal access denied",
      },
    },
    capabilities: {
      autoUpdates: {
        available: false,
        reason: "No host permission to enable APT timer",
      },
    },
  };
}
async function nav(page: Page) {
  if ((page.viewportSize()?.width || 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Security", exact: true })
    .click();
}
for (const width of [320, 768, 1920])
  test(`SSH identifiers and permission states at ${width}px`, async ({
    page,
  }) => {
    await mockDashboard(page);
    await page.route("**/api/v1/security", (r) =>
      r.fulfill({ json: evidence() }),
    );
    await page.setViewportSize({ width, height: 1050 });
    await page.goto("/");
    await nav(page);
    await expect(
      page.getByText("operator · pts/4", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Firewall: Unknown", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("1 unknown checks", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("System journal access denied", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enable upgrade timer", exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.locator("#coreops-sidebar-icon-hover-fix").count()).toBe(
      0,
    );
  });
test("operator cannot trigger administrative actions", async ({ page }) => {
  await mockDashboard(page, "healthy", "operator");
  await page.route("**/api/v1/security", (r) =>
    r.fulfill({ json: evidence() }),
  );
  await page.goto("/");
  await nav(page);
  await expect(
    page.getByText("Read-only access.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Terminate session", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Enable upgrade timer", exact: true }),
  ).toHaveCount(0);
});
test("SSH close reviews full identity and confirms actual disappearance", async ({
  page,
}) => {
  await mockDashboard(page);
  const data = evidence();
  let closed = false;
  let sent: any;
  await page.route("**/api/v1/security", (r) =>
    r.fulfill({ json: { ...data, sessions: closed ? [] : data.sessions } }),
  );
  await page.route("**/api/v1/security/sessions/12345/terminate", (r) => {
    sent = r.request().postDataJSON();
    closed = true;
    return r.fulfill({
      status: 202,
      json: { ok: true, pid: 12345, id, status: "termination_requested" },
    });
  });
  await page.goto("/");
  await nav(page);
  await page
    .getByRole("button", { name: "Terminate session", exact: true })
    .click();
  await expect(page.getByText(/Send SIGTERM to operator/)).toBeVisible();
  await page
    .getByRole("alertdialog", { name: "Terminate SSH session" })
    .getByRole("button", { name: "Terminate session", exact: true })
    .click();
  await expect(
    page.getByText(/Closed — verified by refreshed SSH inventory/),
  ).toBeVisible();
  expect(sent).toEqual({ id });
});
test("stale data survives failed refresh without claiming health", async ({
  page,
}) => {
  await mockDashboard(page);
  let failed = false;
  await page.route("**/api/v1/security", (r) =>
    failed
      ? r.fulfill({
          status: 503,
          json: { error: "Security collection unavailable" },
        })
      : r.fulfill({ json: evidence() }),
  );
  await page.goto("/");
  await nav(page);
  await expect(
    page.getByText("operator · pts/4", { exact: true }),
  ).toBeVisible();
  failed = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Showing older data");
  await expect(
    page.getByText("operator · pts/4", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Terminate session", exact: true }),
  ).toBeDisabled();
});
test("unverified SSH session cannot be closed", async ({ page }) => {
  await mockDashboard(page);
  const data = evidence();
  data.sessions[0].verified = false;
  data.sessions[0].canTerminate = false;
  await page.route("**/api/v1/security", (r) => r.fulfill({ json: data }));
  await page.goto("/");
  await nav(page);
  await expect(
    page.getByRole("button", { name: "Terminate session", exact: true }),
  ).toBeDisabled();
});

test("Tailscale SSH terminal shows provider and real context with actions disabled", async ({
  page,
}) => {
  await mockDashboard(page);
  const base = evidence();
  const data = {
    ...base,
    sessions: [
      {
        ...base.sessions[0],
        user: "pepe",
        name: "pepe · pts/5",
        terminal: "pts/5",
        from: "100.105.4.60",
        method: "Tailscale SSH",
        loginId: "19067",
        process: "bash",
        verified: false,
        canTerminate: false,
        terminationReason: "Tailscale SSH sessions are view only.",
      },
    ],
  };
  await page.route("**/api/v1/security", (r) => r.fulfill({ json: data }));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await nav(page);
  await expect(page.getByText("pepe · pts/5", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Tailscale SSH · view only", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("100.105.4.60", { exact: true })).toBeVisible();
  await expect(page.getByText("1 SSH sessions", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Terminate session", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
