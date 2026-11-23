import { test, expect, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";
const revision = "a".repeat(64);
function snapshot() {
  return {
    available: true,
    state: "Running",
    version: "1.104.7",
    hostname: "owned-host",
    bootId: "boot-test",
    nodeId: "node-test",
    dnsName: "owned-host.example.ts.net",
    ips: ["100.64.0.1", "fd7a:115c:a1e0::1234:5678"],
    online: true,
    tailnet: "test-tailnet",
    health: [],
    preferences: {
      hostname: "",
      wantRunning: true,
      acceptDNS: true,
      acceptRoutes: false,
      ssh: true,
      shieldsUp: false,
      exitNode: "",
      advertiseRoutes: ["192.0.2.0/24"],
    },
    permission: { available: true, mode: "direct", reason: "" },
    peers: [
      {
        id: "peer-one",
        name: "A-very-long-device-name-that-must-wrap-without-pushing-the-mobile-card-outside-the-viewport",
        dnsName: "laptop-with-a-long-dns-name.example-tailnet.ts.net",
        os: "linux",
        ips: ["100.64.0.2", "fd7a:115c:a1e0:1234:5678:9876:abcd:ef01"],
        online: true,
        active: true,
        exitNode: false,
      },
      {
        id: "peer-two",
        name: "Phone",
        dnsName: "phone.example.ts.net",
        os: "android",
        ips: ["100.64.0.3"],
        online: false,
        active: false,
        exitNode: false,
      },
      {
        id: "peer-three",
        name: "Unknown state",
        dnsName: "unknown.example.ts.net",
        os: "",
        ips: [],
        online: null,
        active: null,
        exitNode: false,
      },
    ],
    peerCount: 3,
    peersTruncated: false,
    revision,
    adminUrl: "https://login.tailscale.com/admin/machines",
  };
}
async function openSettings(page: Page) {
  await page.goto("/");
  if ((page.viewportSize()?.width || 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Settings sections", exact: true }),
  ).toBeVisible();
}
async function section(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Settings sections", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
for (const width of [320, 390, 768, 1024, 1440])
  test(`all settings sections fit and keep controls usable at ${width}px`, async ({
    page,
  }) => {
    const c = await mockDashboard(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/api/v1/tailscale", (r) =>
      r.fulfill({ json: snapshot() }),
    );
    await page.route("**/api/v1/users", (r) =>
      r.fulfill({
        json: [{ name: "long-username-with-32-characters", role: "admin" }],
      }),
    );
    await openSettings(page);
    for (const name of [
      "General",
      "Appearance",
      "Notifications",
      "Keyboard",
      "Security",
      "Data",
      "Users",
      "Tailscale",
    ]) {
      await section(page, name);
      await expect(
        page.getByRole("heading", { name, exact: true, level: 2 }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const buttons = page
        .locator(".settings-content button")
        .filter({ visible: true });
      for (const button of await buttons.all()) {
        const box = await button.boundingBox();
        if (box && width < 768)
          expect(box.height, `${name} touch target`).toBeGreaterThanOrEqual(40);
      }
    }
    if (width < 768) {
      const nav = page.getByRole("navigation", {
        name: "Settings sections",
        exact: true,
      });
      expect(await nav.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(
        true,
      );
      await expect(
        nav.getByRole("button", { name: "Tailscale", exact: true }),
      ).toBeInViewport({ ratio: 1 });
    }
    await section(page, "General");
    const toggle = page.getByRole("button", {
      name: "Compact interface",
      exact: true,
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("coreops-web-settings") || "{}")
            .compact,
      ),
    ).toBe(true);
    expect(c.runtimeErrors).toEqual([]);
  });
for (const width of [320, 1440])
  test(`Tailscale changes require review and preserve omitted settings at ${width}px`, async ({
    page,
  }) => {
    const c = await mockDashboard(page);
    await page.setViewportSize({ width, height: 1050 });
    let data = snapshot();
    const writes: any[] = [];
    await page.route("**/api/v1/tailscale", (r) => {
      if (r.request().method() === "POST") {
        const body = r.request().postDataJSON();
        writes.push(body);
        data = {
          ...data,
          revision: "b".repeat(64),
          preferences: { ...data.preferences, ...body.changes },
        };
        return r.fulfill({
          status: 202,
          json: {
            accepted: true,
            action: body.action,
            requestId: body.requestId,
          },
        });
      }
      return r.fulfill({ json: data });
    });
    await openSettings(page);
    await section(page, "Tailscale");
    const view = page.getByRole("region", {
      name: "Tailscale management",
      exact: true,
    });
    await expect(
      view.getByText("owned-host.example.ts.net", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save changes", exact: true }),
    ).toHaveCount(0);
    await view
      .getByRole("switch", { name: "Use Tailscale DNS", exact: true })
      .uncheck();
    await view
      .getByLabel("Tailscale device hostname", { exact: true })
      .fill("renamed-host");
    await view
      .getByRole("button", { name: "Review changes", exact: true })
      .click();
    const modal = page.getByRole("dialog", {
      name: "Apply Tailscale preferences?",
      exact: true,
    });
    await expect(
      modal.getByRole("button", {
        name: "Confirm Tailscale change",
        exact: true,
      }),
    ).toBeDisabled();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(writes).toHaveLength(0);
    await view
      .getByRole("button", { name: "Review changes", exact: true })
      .click();
    await modal
      .getByLabel("Confirm Tailscale host name", { exact: true })
      .fill("owned-host");
    await modal
      .getByRole("button", { name: "Confirm Tailscale change", exact: true })
      .click();
    await expect(
      view.getByText("Tailscale preferences verified on the host.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].changes).toEqual({
      hostname: "renamed-host",
      acceptDNS: false,
    });
    expect(writes[0]).toMatchObject({
      action: "configure",
      hostname: "owned-host",
      revision,
    });
    expect(writes[0].requestId).toMatch(/^[a-f0-9]{32}$/);
    await expect(
      view.getByRole("switch", { name: "Tailscale SSH", exact: true }),
    ).toBeChecked();
    expect(c.runtimeErrors).toEqual([]);
  });
test("Tailscale peer filters, stale reads and permission limits are honest", async ({
  page,
}) => {
  await mockDashboard(page);
  let unavailable = false;
  const data = snapshot();
  data.permission = {
    available: false,
    mode: "",
    reason: "Host permission required",
  };
  let writes = 0;
  await page.route("**/api/v1/tailscale", (r) => {
    if (r.request().method() === "POST") writes++;
    return unavailable
      ? r.fulfill({ status: 503, json: { error: "Daemon status failed" } })
      : r.fulfill({ json: data });
  });
  await openSettings(page);
  await section(page, "Tailscale");
  const view = page.getByRole("region", {
    name: "Tailscale management",
    exact: true,
  });
  await expect(
    view.getByRole("button", { name: "Disconnect Tailscale", exact: true }),
  ).toBeDisabled();
  await expect(
    view.getByText("Host permission required", { exact: true }),
  ).toBeVisible();
  const list = view.getByRole("list", {
    name: "Tailscale devices",
    exact: true,
  });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await view
    .getByLabel("Tailscale device state", { exact: true })
    .selectOption("unknown");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("Unknown state");
  await view
    .getByLabel("Tailscale device state", { exact: true })
    .selectOption("all");
  await view
    .getByLabel("Search Tailscale devices", { exact: true })
    .fill("phone android");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  unavailable = true;
  await view
    .getByRole("button", { name: "Refresh Tailscale", exact: true })
    .click();
  await expect(view.getByRole("alert")).toContainText(
    "previous snapshot may be stale",
  );
  await expect(list.getByRole("listitem")).toHaveCount(1);
  expect(writes).toBe(0);
});
test("stale preferences require reload and an uncertain write is not retried", async ({
  page,
}) => {
  await mockDashboard(page);
  let data = snapshot(),
    writes = 0;
  await page.route("**/api/v1/tailscale", (r) => {
    if (r.request().method() === "POST") {
      writes++;
      return r.fulfill({
        status: 503,
        json: { error: "Outcome is uncertain" },
      });
    }
    return r.fulfill({ json: data });
  });
  await openSettings(page);
  await section(page, "Tailscale");
  const view = page.getByRole("region", {
    name: "Tailscale management",
    exact: true,
  });
  await view
    .getByRole("switch", { name: "Accept subnet routes", exact: true })
    .check();
  data = {
    ...data,
    revision: "c".repeat(64),
    preferences: { ...data.preferences, acceptDNS: false },
  };
  await view
    .getByRole("button", { name: "Refresh Tailscale", exact: true })
    .click();
  await expect(view.getByRole("alert")).toContainText("host changed");
  await expect(
    view.getByRole("button", { name: "Review changes", exact: true }),
  ).toBeDisabled();
  await view
    .getByRole("button", { name: "Reload preferences", exact: true })
    .click();
  await view
    .getByRole("switch", { name: "Accept subnet routes", exact: true })
    .check();
  await view
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Apply Tailscale preferences?",
    exact: true,
  });
  await modal
    .getByLabel("Confirm Tailscale host name", { exact: true })
    .fill("owned-host");
  await modal
    .getByRole("button", { name: "Confirm Tailscale change", exact: true })
    .click();
  await expect(modal.getByRole("alert")).toContainText("No automatic retry");
  expect(writes).toBe(1);
  await expect(
    modal.getByRole("button", {
      name: "Confirm Tailscale change",
      exact: true,
    }),
  ).toHaveCount(0);
});
test("login preparation is explicit and exposes the sign-in link", async ({
  page,
}) => {
  await mockDashboard(page);
  let data: any = {
    ...snapshot(),
    state: "NeedsLogin",
    nodeId: "",
    online: null,
    preferences: { ...snapshot().preferences, wantRunning: false },
  };
  let writes = 0;
  await page.route("**/api/v1/tailscale", (r) => {
    if (r.request().method() === "POST") {
      writes++;
      const body = r.request().postDataJSON();
      expect(body.action).toBe("login");
      expect(body.changes).toEqual({});
      data = { ...data, signInUrl: "https://login.tailscale.com/a/test-only" };
      return r.fulfill({
        status: 202,
        json: {
          accepted: true,
          action: body.action,
          requestId: body.requestId,
        },
      });
    }
    return r.fulfill({ json: data });
  });
  await openSettings(page);
  await section(page, "Tailscale");
  await page
    .getByRole("button", { name: "Prepare sign-in", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Prepare Tailscale sign-in?",
    exact: true,
  });
  await modal
    .getByLabel("Confirm Tailscale host name", { exact: true })
    .fill("owned-host");
  await modal
    .getByRole("button", { name: "Confirm Tailscale change", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open Tailscale sign-in" }),
  ).toHaveAttribute("href", "https://login.tailscale.com/a/test-only");
  expect(writes).toBe(1);
});
for (const role of ["viewer", "operator"])
  test(`${role} cannot view Tailscale administration`, async ({ page }) => {
    await mockDashboard(page, "healthy", role);
    let reads = 0;
    await page.route("**/api/v1/tailscale", (r) => {
      reads++;
      return r.fulfill({ json: snapshot() });
    });
    await openSettings(page);
    await expect(
      page
        .getByRole("navigation", { name: "Settings sections", exact: true })
        .getByRole("button", { name: "Tailscale", exact: true }),
    ).toHaveCount(0);
    expect(reads).toBe(0);
  });

test("native Android layout keeps settings navigation and fields within the WebView", async ({
  page,
}) => {
  const c = await mockDashboard(page);
  await page.addInitScript(() => {
    (window as any).CapacitorCustomPlatform = { name: "android" };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/tailscale", (r) =>
    r.fulfill({ json: snapshot() }),
  );
  await page.goto("/");
  await page.waitForFunction(() => !!document.querySelector("[data-view]"));
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("coreops-native-navigate", {
        detail: { view: "settings" },
      }),
    ),
  );
  await expect(
    page.getByRole("navigation", { name: "Settings sections", exact: true }),
  ).toBeVisible();
  await section(page, "Tailscale");
  await expect(
    page.getByRole("switch", { name: "Use Tailscale DNS", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(
    page
      .getByRole("navigation", { name: "Settings sections", exact: true })
      .getByRole("button", { name: "Tailscale", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(c.runtimeErrors).toEqual([]);
});
test("unavailable daemon is explicit and never reports an empty healthy tailnet", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.route("**/api/v1/tailscale", (r) =>
    r.fulfill({
      json: {
        ...snapshot(),
        available: false,
        state: "Unavailable",
        preferences: null,
        peers: [],
        permission: {
          available: false,
          mode: "",
          reason: "Daemon unavailable",
        },
        detail: "Local daemon cannot be reached",
      },
    }),
  );
  await openSettings(page);
  await section(page, "Tailscale");
  await expect(
    page.getByRole("heading", { name: "Tailscale unavailable", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Local daemon cannot be reached", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Tailscale devices", exact: true }),
  ).toHaveCount(0);
});
