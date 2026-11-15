import { expect, test, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";

async function openTerminal(page: Page) {
  const control = await mockDashboard(page);
  await page.goto("/");
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Terminal", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.locator('.pty-emulator[data-state="connected"]'),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return control;
}
const sizes = [
  { name: "small-phone", width: 320, height: 568, touch: true },
  { name: "phone", width: 390, height: 844, touch: true },
  { name: "landscape", width: 844, height: 390, touch: true },
  { name: "tablet", width: 768, height: 1024, touch: true },
  { name: "tablet-wide", width: 1024, height: 768, touch: true },
  { name: "laptop", width: 1280, height: 800, touch: false },
  { name: "desktop", width: 1920, height: 1080, touch: false },
  { name: "wide", width: 2560, height: 1440, touch: false },
];
for (const size of sizes)
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      hasTouch: size.touch,
    });
    test("terminal fits four sessions with all essential controls reachable", async ({
      page,
    }, info) => {
      const control = await openTerminal(page);
      for (let count = 1; count < 4; count++)
        await page
          .getByRole("button", { name: "New terminal", exact: true })
          .click();
      await expect
        .poll(
          () =>
            control.terminalMessages.filter(
              (message) => message.type === "auth",
            ).length,
        )
        .toBe(4);
      const active = page.getByRole("tab", { name: "Shell 4", exact: true });
      await expect(active).toHaveAttribute("aria-selected", "true");
      await expect(active).toBeInViewport({ ratio: 1 });
      await expect(
        page.getByRole("button", { name: "Close Shell 4", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        page.getByRole("button", { name: "Enter", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        page.locator(".pty-pane:not([hidden]) .xterm-screen"),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        page.getByRole("button", { name: "New terminal", exact: true }),
      ).toBeDisabled();
      const root = await page.locator(".pty-terminal").boundingBox();
      expect(root!.height).toBeGreaterThan(size.height * 0.6);
      const output = await page
        .locator(".pty-pane:not([hidden]) .xterm-screen")
        .boundingBox();
      expect(output!.height).toBeGreaterThan(size.height * 0.45);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      if (size.touch) {
        expect(
          await page
            .locator(".pty-pane:not([hidden]) .xterm-helper-textarea")
            .evaluate((element) => element === document.activeElement),
        ).toBeFalsy();
        for (const name of ["New terminal", "Close Shell 4", "Enter"]) {
          const box = await page
            .getByRole("button", { name, exact: true })
            .boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.width).toBeGreaterThanOrEqual(44);
        }
      }
      await page.screenshot({ path: info.outputPath("terminal.png") });
      expect(control.runtimeErrors).toEqual([]);
    });
  });

test.describe("mobile input and viewport", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("keyboard is explicit and shortcut keys preserve focus without opening a keyboard", async ({
    page,
  }) => {
    const control = await openTerminal(page);
    const input = page.locator(
      ".pty-pane:not([hidden]) .xterm-helper-textarea",
    );
    await expect(input).not.toBeFocused();
    await page
      .getByRole("button", { name: "Show terminal keyboard", exact: true })
      .click();
    await expect(input).toBeFocused();
    await page.keyboard.type("pwd");
    await page.getByRole("button", { name: "Ctrl C", exact: true }).click();
    await expect(input).toBeFocused();
    await page.getByRole("button", { name: "Enter", exact: true }).click();
    await page
      .getByRole("button", { name: "Dismiss terminal keyboard", exact: true })
      .click();
    await expect(input).not.toBeFocused();
    await page.getByRole("button", { name: "Tab", exact: true }).click();
    await expect(input).not.toBeFocused();
    await page
      .getByRole("button", { name: "Arrow right", exact: true })
      .click();
    await expect(input).not.toBeFocused();
    await expect
      .poll(() => control.terminalInputs.join(""))
      .toBe("pwd\x03\r\t\x1b[C");
    await expect(
      page.getByRole("button", { name: "Enter", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      control.terminalMessages.filter((message) => message.type === "auth"),
    ).toHaveLength(1);
  });
  test("actions, search and font changes work from a compact toolbar", async ({
    page,
  }, info) => {
    const control = await openTerminal(page);
    const before = control.terminalMessages
      .filter((message) => message.type === "resize")
      .at(-1)!.cols as number;
    await page
      .getByRole("button", { name: "Terminal actions", exact: true })
      .click();
    const menu = page.getByRole("dialog", {
      name: "Terminal actions",
      exact: true,
    });
    await expect(menu).toBeInViewport({ ratio: 1 });
    await menu
      .getByRole("button", { name: "Increase terminal font", exact: true })
      .click();
    await expect
      .poll(
        () =>
          control.terminalMessages
            .filter((message) => message.type === "resize")
            .at(-1)!.cols as number,
      )
      .toBeLessThan(before);
    await page
      .getByRole("button", { name: "Terminal actions", exact: true })
      .click();
    await menu
      .getByRole("button", { name: "Find in terminal", exact: true })
      .click();
    const search = page.getByRole("textbox", {
      name: "Find in terminal",
      exact: true,
    });
    await expect(search).toBeFocused();
    await search.fill("not a shell command");
    await expect(
      page.getByRole("button", { name: "Close search", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath("terminal-search.png") });
    await page
      .getByRole("button", { name: "Close search", exact: true })
      .click();
    expect(control.terminalInputs).toEqual([]);
    expect(
      control.terminalMessages.filter((message) => message.type === "auth"),
    ).toHaveLength(1);
  });
  test("virtual keyboard, viewport pan and orientation resize the same shell", async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), {
        height: 844,
        width: 390,
        offsetTop: 0,
        offsetLeft: 0,
        scale: 1,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: viewport,
      });
    });
    const control = await openTerminal(page);
    const originalRows = control.terminalMessages
      .filter((message) => message.type === "resize")
      .at(-1)!.rows as number;
    await page
      .getByRole("button", { name: "Show terminal keyboard", exact: true })
      .click();
    await page.evaluate(() => {
      const viewport = window.visualViewport! as unknown as {
        height: number;
        offsetTop: number;
        dispatchEvent: (event: Event) => void;
      };
      viewport.height = 340;
      viewport.offsetTop = 80;
      viewport.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
    });
    await expect
      .poll(async () => {
        const box = await page
          .getByRole("button", { name: "Enter", exact: true })
          .boundingBox();
        return box!.y + box!.height;
      })
      .toBeLessThanOrEqual(420);
    await expect
      .poll(async () => {
        const box = await page.locator(".pty-toolbar").boundingBox();
        return box!.y;
      })
      .toBeGreaterThanOrEqual(80);
    await expect
      .poll(
        () =>
          control.terminalMessages
            .filter((message) => message.type === "resize")
            .at(-1)!.rows as number,
      )
      .toBeLessThan(originalRows);
    const screen = await page
      .locator(".pty-emulator .xterm-screen")
      .boundingBox();
    expect(screen!.height).toBeGreaterThan(60);
    await page.screenshot({ path: info.outputPath("terminal-keyboard.png") });
    await page.evaluate(() => {
      const viewport = window.visualViewport! as unknown as {
        height: number;
        offsetTop: number;
        dispatchEvent: (event: Event) => void;
      };
      viewport.height = 844;
      viewport.offsetTop = 0;
      viewport.dispatchEvent(new Event("resize"));
    });
    await expect
      .poll(
        () =>
          control.terminalMessages
            .filter((message) => message.type === "resize")
            .at(-1)!.rows as number,
      )
      .toBe(originalRows);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => {
      const viewport = window.visualViewport! as unknown as {
        height: number;
        dispatchEvent: (event: Event) => void;
      };
      viewport.height = 390;
      viewport.dispatchEvent(new Event("resize"));
    });
    await expect(
      page.getByRole("button", { name: "Enter", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.keyboard.type("echo same shell");
    await expect
      .poll(() => control.terminalInputs.join(""))
      .toContain("echo same shell");
    expect(
      control.terminalMessages.filter((message) => message.type === "auth"),
    ).toHaveLength(1);
    expect(control.runtimeErrors).toEqual([]);
  });
  test("focus mode uses available space and Escape still reaches terminal programs", async ({
    page,
  }, info) => {
    const control = await openTerminal(page);
    await page
      .getByRole("button", { name: "Terminal actions", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Terminal actions", exact: true })
      .getByRole("button", { name: "Focus terminal", exact: true })
      .click();
    const root = page.locator(".pty-terminal");
    await expect(root).toHaveClass(/pty-focus-mode/);
    await expect
      .poll(async () => {
        const box = await root.boundingBox();
        return box!.y;
      })
      .toBe(0);
    await page
      .getByRole("button", { name: "Show terminal keyboard", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect.poll(() => control.terminalInputs.join("")).toBe("\x1b");
    await expect(root).toHaveClass(/pty-focus-mode/);
    await page.screenshot({ path: info.outputPath("terminal-focus.png") });
    await page
      .getByRole("button", { name: "Terminal actions", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Terminal actions", exact: true })
      .getByRole("button", { name: "Exit terminal focus mode", exact: true })
      .click();
    await expect(root).not.toHaveClass(/pty-focus-mode/);
    await expect(
      page.getByRole("button", { name: "Enter", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      control.terminalMessages.filter((message) => message.type === "auth"),
    ).toHaveLength(1);
  });
});
