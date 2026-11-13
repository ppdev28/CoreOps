import { expect, test } from "@playwright/test";
import { mockDashboard } from "./fixtures";

test("terminal streams keys, keeps independent tabs and survives navigation", async ({
  page,
}) => {
  const control = await mockDashboard(page);
  await page.goto("/");
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await expect(
    page.locator('.pty-emulator[data-state="connected"]'),
  ).toBeVisible();
  await page.keyboard.type("echo persistent");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Tab");
  await expect
    .poll(() => control.terminalInputs.join(""))
    .toBe("echo persistent\r\x03\t");
  // Ctrl+K belongs to readline; the application's command menu must stay closed.
  await page.keyboard.press("Control+k");
  await expect(page.locator(".cmd-backdrop")).toHaveCount(0);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Shell 2", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(
      () => control.terminalMessages.filter((m) => m.type === "auth").length,
    )
    .toBe(2);
  await page.getByRole("tab", { name: "Shell 1", exact: true }).click();
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Dashboard", exact: true })
    .click();
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  expect(
    control.terminalMessages.filter((m) => m.type === "auth"),
  ).toHaveLength(2);
  await page
    .getByRole("button", { name: "Find in terminal", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Find in terminal", exact: true })
    .fill("persistent");
  await page.getByRole("button", { name: "Close search", exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect
    .poll(
      () => control.terminalMessages.filter((m) => m.type === "resize").length,
    )
    .toBeGreaterThan(2);
  await page
    .getByRole("button", { name: "Close Shell 1", exact: true })
    .click();
  await page.getByRole("button", { name: "Close shell", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  expect(control.runtimeErrors).toEqual([]);
});

test("terminal reports shell exit and disconnected state without replaying commands", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.routeWebSocket("**/api/v1/terminal/session", (socket) => {
    socket.onMessage((message) => {
      if (typeof message === "string" && JSON.parse(message).type === "auth") {
        socket.send(
          JSON.stringify({
            type: "ready",
            user: "operator",
            host: "homelab-server",
            shell: "/bin/bash",
          }),
        );
      } else if (typeof message !== "string")
        socket.send(JSON.stringify({ type: "exit", code: 7 }));
    });
  });
  await page.goto("/");
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await expect(
    page.locator('.pty-emulator[data-state="connected"]'),
  ).toBeVisible();
  await page.keyboard.type("x");
  await expect(
    page.getByText(
      "Shell exited with code 7. Open a new terminal to continue.",
    ),
  ).toBeVisible();
  await expect(
    page.locator('.pty-emulator[data-state="exited"]'),
  ).toBeVisible();
});

test("non-admin terminal does not create a privileged connection", async ({
  page,
}) => {
  const control = await mockDashboard(page, "healthy", "viewer");
  await page.goto("/");
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await expect(page.getByText("Administrator access required")).toBeVisible();
  expect(control.terminalMessages).toEqual([]);
});

test("outdated API shows a restart instruction without opening a blank shell", async ({
  page,
}) => {
  const control = await mockDashboard(page);
  await page.route("**/api/v1/terminal/session", (route) =>
    route.fulfill({
      status: 404,
      contentType: "text/plain",
      body: "404 page not found",
    }),
  );
  await page.goto("/");
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Terminal unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This API does not support interactive terminals. Rebuild and restart the CoreOps backend.",
    ),
  ).toBeVisible();
  await expect(page.locator(".pty-emulator")).toHaveCount(0);
  expect(control.terminalMessages).toEqual([]);
  await page.unroute("**/api/v1/terminal/session");
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    page.locator('.pty-emulator[data-state="connected"]'),
  ).toBeVisible();
});

test("failed WebSocket upgrade reports proxy/origin configuration", async ({
  page,
}) => {
  await mockDashboard(page);
  await page.routeWebSocket("**/api/v1/terminal/session", (socket) =>
    socket.close({ code: 1008, reason: "Origin denied" }),
  );
  await page.goto("/");
  await page
    .locator(".sidebar-desktop")
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  await expect(
    page.getByText(
      "WebSocket connection failed before the shell started. Check the proxy upgrade and allowed Origin configuration.",
    ),
  ).toBeVisible();
  await expect(
    page.locator('.pty-emulator[data-state="disconnected"]'),
  ).toBeVisible();
});
