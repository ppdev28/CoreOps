import { test, expect, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";
const host = "owned-host";
const capability = {
  available: true,
  reason: "",
  hostname: host,
  bootId: "owned-boot",
  version: "Trivy 0.76.2",
  targets: [{ id: "host", label: "Host OS packages", kind: "host" }],
};
const posture = {
  apt: {
    installed: true,
    origins: ["Ubuntu:resolute-security"],
    exclusions: ["excluded-test-package"],
    lastRun: "2026-11-22 06:00 UTC",
    lastResult: "success; exit=0",
    rebootRequired: true,
  },
  jails: [
    {
      name: "sshd",
      logPaths: ["/var/log/auth.log"],
      journalMatch: "_SYSTEMD_UNIT=ssh.service",
      actions: "ufw",
      failRegexCount: 5,
      maxRetry: 5,
      findTime: 600,
      banTime: 600,
      currentlyBanned: 2,
      totalBanned: 9,
      status: { state: "ok" },
    },
  ],
  jailsTruncated: false,
  chains: [
    {
      family: "ip",
      table: "filter",
      name: "DOCKER-USER",
      hook: "forward",
      policy: "drop",
      rules: 3,
    },
  ],
  sensors: [
    {
      id: "suricata",
      label: "Suricata",
      kind: "network IDS",
      installed: false,
      active: false,
      detail: "Not installed; network IDS coverage unavailable",
    },
  ],
  sources: {
    "apt-health": { state: "ok" },
    "fail2ban-details": { state: "ok" },
    nft: { state: "ok" },
    sensors: { state: "ok" },
  },
};
async function open(page: Page) {
  await page.goto("/");
  if ((page.viewportSize()?.width || 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Security", exact: true })
    .click();
  await expect(
    page.getByText("Protection coverage", { exact: true }),
  ).toBeVisible();
}
for (const width of [320, 1440])
  test(`detailed evidence and SSH Match evaluation at ${width}px`, async ({
    page,
  }) => {
    const c = await mockDashboard(page);
    await page.setViewportSize({ width, height: 1100 });
    await page.route("**/api/v1/security/posture", (r) =>
      r.fulfill({ json: posture }),
    );
    let inspected = "";
    await page.route("**/api/v1/security/ssh-policy?**", (r) => {
      inspected = r.request().url();
      return r.fulfill({
        json: {
          context: { user: "pepe", address: "192.0.2.10", host: "" },
          checks: [
            {
              id: "key",
              label: "Contextual SSH",
              ok: true,
              status: "pass",
              detail: "Match policy evaluated",
            },
          ],
          authenticationMethods: "publickey",
          allowUsers: "pepe",
          denyUsers: "",
          source: { state: "ok" },
        },
      });
    });
    await open(page);
    await expect(
      page.getByText("A reboot is pending.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Not installed; network IDS coverage unavailable", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("excluded-test-package", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("SSH policy Linux user", { exact: true })
      .fill("pepe");
    await page
      .getByLabel("SSH policy remote address", { exact: true })
      .fill("192.0.2.10");
    await page
      .getByRole("button", { name: "Evaluate policy", exact: true })
      .click();
    await expect(
      page.getByText("Match policy evaluated", { exact: false }),
    ).toBeVisible();
    expect(new URL(inspected).searchParams.get("user")).toBe("pepe");
    expect(new URL(inspected).searchParams.get("address")).toBe("192.0.2.10");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(c.runtimeErrors).toEqual([]);
  });
function entry(id: string, time: string, message: string) {
  return {
    id,
    cursor: `s=${id}`,
    timestamp: time,
    type: "info",
    message,
    source: "tailscaled.service",
  };
}
test("journal navigates real cursors and preserves a page on failure", async ({
  page,
}) => {
  const c = await mockDashboard(page);
  const cursors: string[] = [];
  let fail = false;
  await page.route("**/api/v1/security/events?**", (r) => {
    if (fail)
      return r.fulfill({ status: 503, json: { error: "Journal unavailable" } });
    const q = new URL(r.request().url()).searchParams;
    const cursor = q.get("cursor") || "";
    cursors.push(cursor);
    const old = !!cursor;
    return r.fulfill({
      json: {
        events: [
          entry(
            old ? "old" : "new",
            "2026-11-22T00:00:00Z",
            old ? "Older retained record" : "Latest Tailscale record",
          ),
        ],
        signals: [],
        oldestCursor: old ? "s=old" : "s=new",
        newestCursor: old ? "s=old" : "s=new",
        hasMore: !old,
        source: { state: "ok" },
        updatedAt: new Date().toISOString(),
      },
    });
  });
  await open(page);
  await expect(
    page.getByText("Latest Tailscale record", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Older events", exact: true }).click();
  await expect(
    page.getByText("Older retained record", { exact: true }),
  ).toBeVisible();
  expect(cursors).toContain("s=new");
  await expect(
    page.getByLabel("Live security journal", { exact: true }),
  ).not.toBeChecked();
  fail = true;
  await page.getByRole("button", { name: "Newer events", exact: true }).click();
  await expect(
    page.getByText("Previous journal page remains visible.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Older retained record", { exact: true }),
  ).toBeVisible();
  expect(c.runtimeErrors).toEqual([]);
});
const report = {
  scanner: "Trivy",
  scannedAt: "2026-11-22T12:00:00Z",
  databaseUpdatedAt: new Date().toISOString(),
  os: "ubuntu 26.04",
  endOfLife: false,
  packages: 200,
  vulnerabilities: [
    {
      id: "CVE-test-high",
      package: "test-package",
      installed: "1",
      fixed: "2",
      severity: "HIGH",
      title: "Test finding",
      url: "https://example.com/advisory",
      target: "ubuntu",
    },
  ],
  counts: { HIGH: 1 },
  truncated: false,
  coverage: "Host OS package snapshot; no secret scanning",
};
for (const width of [320, 1440])
  test(`scan requires hostname review and renders fixes at ${width}px`, async ({
    page,
  }) => {
    const c = await mockDashboard(page);
    await page.setViewportSize({ width, height: 1100 });
    await page.route("**/api/v1/security/scans/capabilities", (r) =>
      r.fulfill({ json: capability }),
    );
    let writes = 0;
    let jobs: any[] = [];
    await page.route("**/api/v1/security/scans", (r) => {
      if (r.request().method() === "POST") {
        writes++;
        const body = r.request().postDataJSON();
        expect(body.target).toBe("host");
        expect(body.hostname).toBe(host);
        expect(body.bootId).toBe("owned-boot");
        expect(body.requestId).toMatch(/^[a-f0-9]{32}$/);
        const job = {
          id: body.requestId,
          target: "host",
          status: "running",
          startedAt: new Date().toISOString(),
        };
        jobs = [
          {
            ...job,
            status: "succeeded",
            finishedAt: new Date().toISOString(),
            report,
          },
        ];
        return r.fulfill({ status: 202, json: job });
      }
      return r.fulfill({ json: jobs });
    });
    await open(page);
    const confirm = page.getByLabel("Confirm vulnerability scan hostname", {
      exact: true,
    });
    await confirm.fill("wrong-host");
    await expect(
      page.getByRole("button", { name: "Review scan", exact: true }),
    ).toBeDisabled();
    await confirm.fill(host);
    await page
      .getByRole("button", { name: "Review scan", exact: true })
      .click();
    let dialog = page.getByRole("alertdialog", {
      name: "Run vulnerability scan",
      exact: true,
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(writes).toBe(0);
    await page
      .getByRole("button", { name: "Review scan", exact: true })
      .click();
    dialog = page.getByRole("alertdialog", {
      name: "Run vulnerability scan",
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Start scan", exact: true })
      .click();
    await expect(
      page.getByRole("table", { name: "Vulnerability findings", exact: true }),
    ).toContainText("CVE-test-high");
    expect(writes).toBe(1);
    await page
      .getByLabel("Vulnerability severity", { exact: true })
      .selectOption("LOW");
    await expect(
      page.getByText("No findings match these filters.", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(c.runtimeErrors).toEqual([]);
  });
test("operator reads scanner state without starting scans or accessing audit", async ({
  page,
}) => {
  const c = await mockDashboard(page, "healthy", "operator");
  await page.route("**/api/v1/security/scans/capabilities", (r) =>
    r.fulfill({ json: capability }),
  );
  await open(page);
  await expect(
    page.getByText("Only an administrator can start scans.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review scan", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Verify audit chain", exact: true }),
  ).toHaveCount(0);
  expect(c.runtimeErrors).toEqual([]);
});
test("uncertain scan request is never retried automatically", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.route("**/api/v1/security/scans/capabilities", (r) =>
    r.fulfill({ json: capability }),
  );
  let writes = 0;
  await page.route("**/api/v1/security/scans", (r) => {
    if (r.request().method() === "POST") {
      writes++;
      return r.fulfill({ status: 503, json: { error: "Outcome uncertain" } });
    }
    return r.fulfill({ json: [] });
  });
  await open(page);
  await page
    .getByLabel("Confirm vulnerability scan hostname", { exact: true })
    .fill(host);
  await page.getByRole("button", { name: "Review scan", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Run vulnerability scan", exact: true })
    .getByRole("button", { name: "Start scan", exact: true })
    .click();
  await expect(
    page.getByText("requests are not automatically retried.", { exact: false }),
  ).toBeVisible();
  await page.waitForTimeout(2200);
  expect(writes).toBe(1);
});
test("audit verification exposes legacy coverage and fails visibly", async ({
  page,
}) => {
  await mockDashboard(page);
  let broken = false;
  await page.route("**/api/v1/audit/integrity", (r) =>
    broken
      ? r.fulfill({ status: 503, json: { error: "Audit integrity failed" } })
      : r.fulfill({
          json: {
            state: "legacy_partial",
            records: 20,
            legacyRecords: 10,
            files: 2,
            retention: "Bounded local retention",
            detail: "Legacy entries are not hash-protected",
            sequence: 10,
            lastHash: "a".repeat(64),
          },
        }),
  );
  await open(page);
  await page
    .getByRole("button", { name: "Verify audit chain", exact: true })
    .click();
  await expect(page.getByText("legacy_partial", { exact: true })).toBeVisible();
  broken = true;
  await page
    .getByRole("button", { name: "Verify audit chain", exact: true })
    .click();
  await expect(
    page.getByText("Audit integrity failed", { exact: true }),
  ).toBeVisible();
});
test("monitor checkpoint reset requires explicit gap acknowledgement", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.route("**/api/v1/security/monitor", (r) =>
    r.fulfill({
      json: {
        state: "partial",
        detail: "Cursor no longer retained",
        signals: [],
        backlog: false,
        retainedEvents: 0,
        lastCollected: "",
        coverageSince: "",
      },
    }),
  );
  let writes = 0;
  await page.route("**/api/v1/security/monitor/reset", (r) => {
    writes++;
    expect(r.request().postDataJSON()).toEqual({ acknowledgeGap: true });
    return r.fulfill({ status: 202, json: { accepted: true } });
  });
  await open(page);
  await page
    .getByRole("button", { name: "Review checkpoint reset", exact: true })
    .click();
  await page
    .getByRole("alertdialog", {
      name: "Reset Security journal checkpoint",
      exact: true,
    })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(writes).toBe(0);
  await page
    .getByRole("button", { name: "Review checkpoint reset", exact: true })
    .click();
  await page
    .getByRole("alertdialog", {
      name: "Reset Security journal checkpoint",
      exact: true,
    })
    .getByRole("button", { name: "Acknowledge gap and reset", exact: true })
    .click();
  await expect.poll(() => writes).toBe(1);
});
