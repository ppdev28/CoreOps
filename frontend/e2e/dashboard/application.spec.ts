import { test, expect, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";

const screens = [
  ["dashboard", "Dashboard"],
  ["host", "Host"],
  ["containers", "Containers"],
  ["applications", "Applications"],
  ["services", "Services"],
  ["storage", "Storage"],
  ["network", "Network"],
  ["virtual-machines", "Virtual machines"],
  ["monitoring", "Monitoring"],
  ["logs", "Logs"],
  ["terminal", "Terminal"],
  ["security", "Security"],
  ["updates", "Updates"],
  ["settings", "Settings"],
] as const;
async function navigate(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name, exact: true })
    .filter({ visible: true })
    .click();
}
const formats = [
  { name: "small-phone", width: 320, height: 740 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1920, height: 1080 },
  { name: "wide-desktop", width: 2560, height: 1440 },
];
for (const format of formats)
  test(`all screens: ${format.name}`, async ({ page }, info) => {
    test.setTimeout(60000);
    const control = await mockDashboard(page);
    await page.setViewportSize(format);
    await page.goto("/");
    await expect(
      page.getByText("All systems operational", { exact: true }),
    ).toBeVisible();
    for (const [id, name] of screens) {
      if (id !== "dashboard") await navigate(page, name);
      await expect(page.locator(`[data-screen="${id}"]`)).toBeVisible();
      const screen = page.locator(`[data-screen="${id}"]`);
      await expect(screen.locator("[data-screen-loading]")).toHaveCount(0);
      const ready = {
        dashboard: "All systems operational",
        host: "Ubuntu 24.04 LTS",
        containers: "nginx",
        applications: "Homelab",
        services: "ssh.service",
        storage: "/dev/nvme0n1p2",
        network: "eth0",
        "virtual-machines": "development-server",
        monitoring: "CPU Usage",
        logs: "Backup completed",
        security: "SSH session opened",
        updates: "System is up to date",
        settings: "CoreOps web app",
      };
      if (id === "terminal")
        await expect(screen.locator(".termx-input-card input")).toBeVisible();
      else
        await expect(
          screen
            .getByText(ready[id as keyof typeof ready], { exact: false })
            .filter({ visible: true })
            .first(),
        ).toBeVisible();
      if (id === "settings") {
        await screen.getByRole("button", { name: /^Appearance/ }).click();
        await expect(
          screen.getByRole("button", { name: "Violet accent", exact: true }),
        ).toBeVisible();
      }
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page
        .locator(".coreops-screen, .coreops-screen > div, .coreops-header")
        .evaluateAll((nodes) =>
          nodes
            .filter((el) => el.scrollWidth > el.clientWidth + 2)
            .map((el) => ({
              class: el.className,
              width: el.clientWidth,
              scroll: el.scrollWidth,
            })),
        );
      expect(overflow, `${name} overflows at ${format.width}px`).toEqual([]);
      expect(control.runtimeErrors, `${name} runtime errors`).toEqual([]);
      if (
        (id === "services" || id === "settings" || id === "terminal") &&
        [390, 1280].includes(format.width)
      )
        await page.screenshot({
          path: info.outputPath(`${id}-${format.name}.png`),
          fullPage: true,
        });
    }
    await navigate(page, "Dashboard");
    await page
      .getByRole("button", { name: "Inspect nginx", exact: true })
      .click();
    await expect(
      page.locator('[data-screen="container-detail"]'),
    ).toBeVisible();
    await expect
      .poll(() => control.requests.includes("/containers/abcdef123450"))
      .toBe(true);
    expect(control.runtimeErrors).toEqual([]);
  });

test("appearance presets, live theme changes, custom contrast and persistence", async ({
  page,
}) => {
  const control = await mockDashboard(page);
  await page.goto("/");
  await navigate(page, "Settings");
  await page.getByRole("button", { name: /^Appearance/ }).click();
  await page.getByRole("button", { name: "Blue accent", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-coreops-accent",
    "#60a5fa",
  );
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Blue accent", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const theme of ["gray", "light", "dark"]) {
    await page.getByRole("combobox").first().selectOption(theme);
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-coreops-theme",
      theme,
    );
    await expect(page.locator('[data-screen="settings"]')).toBeVisible();
  }
  await page.getByLabel("Custom accent color").fill("#090909");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-coreops-accent",
    "#090909",
  );
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toHaveCSS("background-color", "rgb(9, 9, 9)");
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-coreops-accent",
    "#090909",
  );
  await navigate(page, "Settings");
  await page.getByRole("button", { name: /^Appearance/ }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("combobox").first().selectOption("system");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-coreops-theme",
    "light",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-coreops-theme",
    "dark",
  );
  expect(control.runtimeErrors).toEqual([]);
});

test("invalid stored accents fall back safely and login shares appearance", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "coreops-web-settings",
      JSON.stringify({ theme: "gray", accentColor: "url(javascript:invalid)" }),
    ),
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-coreops-accent",
    "neutral",
  );
  await expect(page.locator(".login-screen")).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign in/ })).toBeVisible();
});
