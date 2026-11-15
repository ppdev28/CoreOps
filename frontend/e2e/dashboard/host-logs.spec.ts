import { expect, test, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";

test.use({ timezoneId: "UTC" });
async function hostLogs(page: Page) {
  const control = await mockDashboard(page);
  const requests: URL[] = [];
  await page.route("**/api/v1/logs**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.pathname.endsWith("/sources"))
      return route.fulfill({
        json: {
          files: [
            {
              path: "syslog",
              name: "/var/log/syslog",
              readable: true,
              archive: false,
            },
            {
              path: "syslog.1.gz",
              name: "/var/log/syslog.1.gz",
              readable: true,
              archive: true,
            },
            {
              path: "auth.log",
              name: "/var/log/auth.log",
              readable: false,
              archive: false,
            },
          ],
          warnings: ["Cannot list host log directory: private"],
        },
      });
    const source = url.searchParams.get("source");
    const file = url.searchParams.get("file");
    const old = url.searchParams.has("cursor");
    if (file === "auth.log")
      return route.fulfill({
        status: 403,
        json: { error: "Host log requires read permission" },
      });
    const message =
      source === "system"
        ? old
          ? "Retained previous boot event"
          : "Recent system event"
        : source === "events"
          ? "container start nginx"
          : file?.endsWith(".gz")
            ? old
              ? "Archive next page"
              : "Archive first page"
            : file
              ? old
                ? "Earlier syslog entry"
                : "Latest syslog entry"
              : "Recent aggregate entry";
    return route.fulfill({
      json: {
        entries: [
          {
            timestamp: old ? "2025-01-01T12:00:00Z" : "2026-11-15T12:00:00Z",
            level: "INFO",
            source: source === "system" ? "ssh.service" : file || "System",
            message,
            stream: source === "system" ? "journal" : "file",
          },
        ],
        sources: [],
        updatedAt: "2026-11-15T12:00:00Z",
        nextCursor: old
          ? undefined
          : source === "system"
            ? "s=journal;i=123"
            : file
              ? "file-position"
              : undefined,
        historyOrder: file?.endsWith(".gz") ? "newer" : "older",
        warnings:
          source === "events"
            ? ["Only Docker's retained event buffer is available."]
            : [],
      },
    });
  });
  await page.goto("/");
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator(".sidebar-desktop, [style*='z-index: 101']")
    .getByRole("button", { name: "Logs", exact: true })
    .filter({ visible: true })
    .click();
  return { requests, control };
}
async function openSources(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page
      .getByRole("button", { name: "Select log source", exact: true })
      .click();
}

test("journal history traverses retained boots, freezes pages and applies server time/unit filters", async ({
  page,
}) => {
  const { requests, control } = await hostLogs(page);
  await page
    .getByRole("button", { name: "System journal", exact: true })
    .click();
  const pane = page.getByRole("region", {
    name: "System journal logs",
    exact: true,
  });
  await expect(pane).toContainText("Recent system event");
  await pane
    .getByRole("button", { name: "Older entries", exact: true })
    .click();
  await expect(pane).toContainText("Retained previous boot event");
  expect(
    requests.some(
      (url) => url.searchParams.get("cursor") === "s=journal;i=123",
    ),
  ).toBeTruthy();
  await expect(
    pane.getByRole("button", { name: "Older entries", exact: true }),
  ).toBeDisabled();
  await expect(pane).toContainText("History");
  await page
    .getByRole("button", { name: "Resume log updates", exact: true })
    .click();
  const count = requests.filter(
    (url) => url.searchParams.get("source") === "system",
  ).length;
  await page.waitForTimeout(2300);
  expect(
    requests.filter((url) => url.searchParams.get("source") === "system"),
  ).toHaveLength(count);
  await pane
    .getByRole("button", { name: "Return to latest", exact: true })
    .click();
  await expect(pane).toContainText("Recent system event");
  await page
    .getByRole("button", { name: "Host history filters", exact: true })
    .click();
  await page
    .getByLabel("Host logs from", { exact: true })
    .fill("2025-01-01T00:00");
  await page
    .getByLabel("Host logs until", { exact: true })
    .fill("2025-01-02T00:00");
  await page.getByLabel("Journal unit", { exact: true }).fill("ssh.service");
  await page
    .getByRole("button", { name: "Apply history filters", exact: true })
    .click();
  await expect
    .poll(() =>
      requests.some(
        (url) =>
          url.searchParams.get("since") === "2025-01-01T00:00:00.000Z" &&
          url.searchParams.get("unit") === "ssh.service" &&
          !url.searchParams.has("cursor"),
      ),
    )
    .toBeTruthy();
  expect(control.runtimeErrors).toEqual([]);
});

test("host text files, rotated archives and inaccessible sources are exposed honestly", async ({
  page,
}) => {
  const { requests, control } = await hostLogs(page);
  await page.locator(".logs-file-catalog summary").click();
  await page
    .getByRole("button", { name: "Open host log syslog", exact: true })
    .click();
  const pane = page.getByRole("region", {
    name: "/var/log/syslog logs",
    exact: true,
  });
  await expect(pane).toContainText("Latest syslog entry");
  await pane
    .getByRole("button", { name: "Older entries", exact: true })
    .click();
  await expect(pane).toContainText("Earlier syslog entry");
  await page
    .getByRole("button", { name: "Open host log syslog.1.gz", exact: true })
    .click();
  const archive = page.getByRole("region", {
    name: "/var/log/syslog.1.gz logs",
    exact: true,
  });
  await expect(archive).toContainText("Archive first page");
  await archive
    .getByRole("button", { name: "Next archive page", exact: true })
    .click();
  await expect(archive).toContainText("Archive next page");
  await page
    .getByRole("button", { name: "Open host log auth.log", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Host log requires read permission",
  );
  expect(
    requests.some(
      (url) =>
        url.searchParams.get("file") === "syslog.1.gz" &&
        url.searchParams.get("cursor") === "file-position",
    ),
  ).toBeTruthy();
  expect(control.runtimeErrors).toEqual([]);
});

test("mobile host sources, event retention and time filters fit 320px", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const { requests, control } = await hostLogs(page);
  await openSources(page);
  await page
    .getByRole("button", { name: "Docker events", exact: true })
    .click();
  const pane = page.getByRole("region", {
    name: "Docker events logs",
    exact: true,
  });
  await expect(pane).toContainText("container start nginx");
  await pane.locator("summary").click();
  await expect(pane).toContainText("retained event buffer");
  await page
    .getByRole("button", { name: "Host history filters", exact: true })
    .click();
  await expect(
    page.getByLabel("Host logs from", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
  expect(
    requests.some((url) => url.searchParams.get("source") === "events"),
  ).toBeTruthy();
  expect(control.runtimeErrors).toEqual([]);
  await page.screenshot({ path: info.outputPath("host-events-mobile.png") });
});
