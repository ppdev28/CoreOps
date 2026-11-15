import { expect, test, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";

const id = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const document =
  "services:\n  web:\n    image: nginx:alpine\n    ports: ['8088:80']\n";
async function openCompose(page: Page, role = "admin") {
  const control = await mockDashboard(page, "healthy", role);
  const state = {
    available: true,
    validationError: "",
    partial: false,
    createCalls: 0,
    validateCalls: 0,
    input: null as Record<string, any> | null,
    hold: Promise.resolve(),
  };
  await page.route("**/api/v1/compose**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/compose"))
      return route.fulfill({
        json: {
          available: state.available,
          version: "5.7.0",
          reason: state.available
            ? ""
            : "Docker Compose is unavailable on this server",
        },
      });
    if (url.pathname.endsWith("/validate")) {
      state.validateCalls++;
      const input = route.request().postDataJSON();
      if (state.validationError)
        return route.fulfill({
          status: 400,
          json: { error: state.validationError },
        });
      return route.fulfill({
        json: {
          project: input.project,
          hash: "fixture-hash",
          services: [
            {
              name: "web",
              image: "nginx:alpine",
              ports: ["127.0.0.1:8088 → 80/tcp"],
            },
          ],
          volumes: [],
          warnings: ["Local images only."],
        },
      });
    }
    state.createCalls++;
    state.input = route.request().postDataJSON();
    await state.hold;
    return route.fulfill({
      status: state.partial ? 202 : 201,
      json: {
        project: state.input!.project,
        state: state.partial
          ? "partial"
          : state.input!.start
            ? "started"
            : "created",
        containers: [
          {
            id,
            name: `${state.input!.project}-web-1`,
            service: "web",
            status: state.partial
              ? "created"
              : state.input!.start
                ? "running"
                : "created",
          },
        ],
        warnings: [],
        operationError: state.partial
          ? "Some steps failed. Inspect existing resources; do not submit again."
          : undefined,
      },
    });
  });
  await page.goto("/");
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Containers", exact: true })
    .filter({ visible: true })
    .click();
  return {
    control,
    state,
    open: async (expectAvailable = true) => {
      await page
        .getByRole("button", { name: "Create container", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Create container",
        exact: true,
      });
      await dialog
        .getByRole("tab", { name: "Docker Compose", exact: true })
        .click();
      if (expectAvailable)
        await expect(
          dialog.getByRole("button", { name: "Validate Compose", exact: true }),
        ).toBeEnabled();
      return dialog;
    },
  };
}
async function configure(dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByLabel("Project name", { exact: true }).fill("my-stack");
  await dialog
    .getByRole("textbox", { name: "Compose YAML", exact: true })
    .fill(document);
  await dialog
    .getByRole("button", { name: "Validate Compose", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", {
      name: "Compose validation result",
      exact: true,
    }),
  ).toContainText("127.0.0.1:8088");
}

test("Compose validates, prevents duplicate creates and locks close until completion", async ({
  page,
}) => {
  const { state, open, control } = await openCompose(page);
  const dialog = await open();
  await expect(
    dialog.getByRole("button", { name: "Create Compose project", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByLabel("Start services after creation", { exact: true }),
  ).not.toBeChecked();
  await configure(dialog);
  let finish!: () => void;
  state.hold = new Promise((resolve) => (finish = resolve));
  await dialog
    .getByRole("button", { name: "Create Compose project", exact: true })
    .click();
  await expect.poll(() => state.createCalls).toBe(1);
  await expect(
    dialog.getByRole("tab", { name: "Single container", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Close create container", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  finish();
  await expect(dialog).toContainText("Compose project created");
  expect(state.input).toEqual({
    project: "my-stack",
    compose: document,
    start: false,
    validationHash: "fixture-hash",
  });
  await expect(dialog).toContainText("my-stack-web-1");
  expect(state.createCalls).toBe(1);
  expect(control.runtimeErrors).toEqual([]);
});
test("Compose edits invalidate validation and both creation modes retain their drafts", async ({
  page,
}) => {
  const { open, state } = await openCompose(page);
  const dialog = await open();
  await dialog
    .getByRole("tab", { name: "Single container", exact: true })
    .click();
  await dialog
    .getByLabel("Container name", { exact: true })
    .fill("single-draft");
  await dialog
    .getByRole("tab", { name: "Docker Compose", exact: true })
    .click();
  await configure(dialog);
  await dialog
    .getByRole("textbox", { name: "Compose YAML", exact: true })
    .fill(document + "# changed\n");
  await expect(
    dialog.getByRole("button", { name: "Create Compose project", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("tab", { name: "Single container", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Container name", { exact: true }),
  ).toHaveValue("single-draft");
  await dialog
    .getByRole("tab", { name: "Docker Compose", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Compose YAML", exact: true }),
  ).toHaveValue(document + "# changed\n");
  expect(state.createCalls).toBe(0);
});
test("Compose validation failures preserve YAML and partial start never permits resubmission", async ({
  page,
}) => {
  const { open, state } = await openCompose(page);
  const dialog = await open();
  state.validationError = "Host bind mounts are disabled";
  await dialog.getByLabel("Project name", { exact: true }).fill("my-stack");
  await dialog
    .getByRole("textbox", { name: "Compose YAML", exact: true })
    .fill(document);
  await dialog
    .getByRole("button", { name: "Validate Compose", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Host bind mounts");
  await expect(
    dialog.getByRole("textbox", { name: "Compose YAML", exact: true }),
  ).toHaveValue(document);
  state.validationError = "";
  await configure(dialog);
  await dialog
    .getByLabel("Start services after creation", { exact: true })
    .check();
  state.partial = true;
  await dialog
    .getByRole("button", { name: "Create Compose project", exact: true })
    .click();
  await expect(dialog).toContainText("Project needs inspection");
  await expect(dialog).toContainText("do not submit again");
  await expect(
    dialog.getByRole("button", { name: "Create Compose project", exact: true }),
  ).toHaveCount(0);
  expect(state.input!.start).toBeTruthy();
  expect(state.createCalls).toBe(1);
});
test("Compose YAML upload, validation and result fit a 320px phone", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const { open, control } = await openCompose(page);
  const dialog = await open();
  await dialog.getByLabel("Project name", { exact: true }).fill("mobile-stack");
  await dialog.getByLabel("Load Compose file", { exact: true }).setInputFiles({
    name: "compose.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(document),
  });
  await expect(
    dialog.getByRole("textbox", { name: "Compose YAML", exact: true }),
  ).toHaveValue(document);
  await dialog
    .getByRole("button", { name: "Validate Compose", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Create Compose project", exact: true }),
  ).toBeEnabled();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: info.outputPath("compose-mobile.png") });
  await dialog
    .getByRole("button", { name: "Create Compose project", exact: true })
    .click();
  await expect(dialog).toContainText("Compose project created");
  expect(control.runtimeErrors).toEqual([]);
});
for (const role of ["viewer", "operator"])
  test(`${role} cannot open Compose creation`, async ({ page }) => {
    const { state } = await openCompose(page, role);
    await expect(
      page.getByRole("button", { name: "Create container", exact: true }),
    ).toHaveCount(0);
    expect(state.validateCalls + state.createCalls).toBe(0);
  });

test("missing Compose disables creation and retry discovers the plugin", async ({
  page,
}) => {
  const { open, state } = await openCompose(page);
  state.available = false;
  const dialog = await open(false);
  await expect(dialog.getByRole("alert")).toContainText(
    "Docker Compose is unavailable",
  );
  await expect(
    dialog.getByRole("button", { name: "Validate Compose", exact: true }),
  ).toBeDisabled();
  expect(state.createCalls).toBe(0);
  state.available = true;
  await dialog
    .getByRole("button", { name: "Retry Compose check", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Validate Compose", exact: true }),
  ).toBeEnabled();
});
