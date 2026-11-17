import { expect, test, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";

async function openFiles(page: Page) {
  await page.goto("/");
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Files", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View file: example.txt", exact: true })
    .click();
  return page.getByRole("dialog", { name: "example.txt", exact: true });
}

for (const width of [1440, 390]) {
  test(`file viewer safely displays text and restores focus at ${width}px`, async ({
    page,
  }) => {
    const control = await mockDashboard(page);
    const dialog = await openFiles(page);
    await page.setViewportSize({ width, height: 844 });
    await expect(dialog.getByLabel("File contents")).toContainText("<script>");
    expect(await page.evaluate(() => "untrustedFileExecuted" in window)).toBe(
      false,
    );
    await dialog.getByLabel("Wrap lines").uncheck();
    await expect(dialog.locator("pre")).toHaveAttribute("data-wrap", "false");
    expect(
      await dialog.evaluate(
        (el) => el.getBoundingClientRect().right <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "View file: example.txt", exact: true }),
    ).toBeFocused();
    expect(control.requests).toContain("/files/preview");
    expect(control.requests).not.toContain("/files/download-ticket");
    expect(control.runtimeErrors).toEqual([]);
  });
}
test("file viewer displays raster images and releases the viewer", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.route("**/api/v1/files/preview?**", (route) =>
    route.fulfill({
      json: {
        path: "/example.txt",
        kind: "image",
        mediaType: "image/png",
        content:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        size: 68,
        truncated: false,
      },
    }),
  );
  const dialog = await openFiles(page);
  await expect(dialog.getByRole("img")).toBeVisible();
  await expect
    .poll(() =>
      dialog
        .getByRole("img")
        .evaluate((el: HTMLImageElement) => el.naturalWidth),
    )
    .toBe(1);
  await dialog.getByRole("button", { name: "Close file viewer" }).click();
  await expect(dialog).toHaveCount(0);
});
test("file viewer explains binary, truncated and changed-file results", async ({
  page,
}) => {
  await mockDashboard(page);
  let kind = "unavailable";
  await page.route("**/api/v1/files/preview?**", (route) =>
    kind === "error"
      ? route.fulfill({
          status: 409,
          json: { error: "File changed. Refresh the folder." },
        })
      : route.fulfill({
          json: {
            path: "/example.txt",
            kind,
            content: "partial text",
            size: 1000000,
            truncated: kind === "text",
            reason: "Download this binary file to open it.",
          },
        }),
  );
  let dialog = await openFiles(page);
  await expect(
    dialog.getByText("Preview unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Download", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  kind = "text";
  await page
    .getByRole("button", { name: "View file: example.txt", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("first 256 KiB");
  await page.keyboard.press("Escape");
  kind = "error";
  await page
    .getByRole("button", { name: "View file: example.txt", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("File changed");
});
