import { expect, test, type Page } from "@playwright/test";
import { mockDashboard } from "./fixtures";

const id = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async function openContainers(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page
    .locator("aside nav")
    .getByRole("button", { name: "Containers", exact: true })
    .filter({ visible: true })
    .click();
}

test("create configures Docker, prevents duplicate submissions and opens real detail", async ({
  page,
}) => {
  const control = await mockDashboard(page);
  let created: Record<string, any> | null = null;
  let calls = 0;
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/v1/containers", async (route) => {
    if (route.request().method() === "POST") {
      calls++;
      created = route.request().postDataJSON();
      await held;
      return route.fulfill({
        status: 201,
        json: { id, name: created!.name, started: false, warnings: [] },
      });
    }
    if (!created) return route.fallback();
    return route.fulfill({
      json: [
        {
          id,
          name: created.name,
          image: created.image,
          state: "created",
          status: "Created",
          createdAt: 1800000000,
          ports: [],
          networks: ["bridge"],
        },
      ],
    });
  });
  await page.route(`**/api/v1/containers/${id}`, (route) =>
    route.fulfill({
      json: {
        id,
        name: created!.name,
        image: created!.image,
        state: "created",
        created: "2026-11-15T12:00:00Z",
        config: {
          env: created!.environment,
          cmd: created!.command,
          entrypoint: [],
          workingDir: "",
        },
        ports: {},
        networks: {},
        mounts: [],
        labels: {},
        restartPolicy: "no",
      },
    }),
  );
  await page.goto("/");
  await openContainers(page);
  await page
    .getByRole("button", { name: "Create container", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create container",
    exact: true,
  });
  await dialog.getByLabel("Container name", { exact: true }).fill("web-test");
  await dialog.getByLabel("Image", { exact: true }).fill("nginx:stable");
  await dialog.getByRole("button", { name: "Add port" }).click();
  await expect(dialog.getByLabel("Host IP 1", { exact: true })).toHaveValue(
    "127.0.0.1",
  );
  await dialog.getByLabel("Host port 1", { exact: true }).fill("18080");
  await dialog.getByLabel("Container port 1", { exact: true }).fill("80");
  await dialog
    .getByLabel("Environment variables")
    .fill("TZ=Europe/Madrid\nTOKEN=fixture-only-secret");
  await dialog.getByText("Command and restart policy", { exact: true }).click();
  await dialog.getByLabel("Command arguments").fill("nginx\n-g\ndaemon off;");
  await expect(dialog.getByLabel("Start after creation")).not.toBeChecked();
  await dialog
    .getByRole("button", { name: "Create container", exact: true })
    .click();
  await expect.poll(() => calls).toBe(1);
  await expect(
    dialog.getByRole("button", { name: "Creating…", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(created).toEqual({
    name: "web-test",
    image: "nginx:stable",
    environment: ["TZ=Europe/Madrid", "TOKEN=fixture-only-secret"],
    command: ["nginx", "-g", "daemon off;"],
    ports: [
      {
        hostIp: "127.0.0.1",
        hostPort: 18080,
        containerPort: 80,
        protocol: "tcp",
      },
    ],
    restartPolicy: "no",
    start: false,
  });
  finish();
  await expect(
    dialog.getByRole("heading", { name: "web-test created" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Create container", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Inspect container", exact: true })
    .click();
  await expect(page.locator('[data-screen="container-detail"]')).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "web-test", exact: true }),
  ).toBeVisible();
  expect(calls).toBe(1);
  expect(control.runtimeErrors).toEqual([]);
});

test("create keeps errors and input, then reconciles partial start without recreating", async ({
  page,
}) => {
  const control = await mockDashboard(page);
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/v1/containers", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    requests.push(route.request().postDataJSON());
    if (requests.length === 1)
      return route.fulfill({
        status: 409,
        json: { error: "a container with this name already exists" },
      });
    return route.fulfill({
      status: 201,
      json: {
        id,
        name: "another-name",
        started: false,
        warnings: ["Storage warning"],
        startError:
          "Container created, but Docker could not confirm its start.",
      },
    });
  });
  await page.goto("/");
  await openContainers(page);
  await page
    .getByRole("button", { name: "Create container", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Container name", { exact: true })
    .fill("existing-name");
  await dialog.getByLabel("Image", { exact: true }).fill("nginx:stable");
  await dialog.getByLabel("Start after creation").check();
  await dialog
    .getByRole("button", { name: "Create and start", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "a container with this name already exists",
  );
  await expect(dialog.getByLabel("Image", { exact: true })).toHaveValue(
    "nginx:stable",
  );
  await dialog
    .getByLabel("Container name", { exact: true })
    .fill("another-name");
  await dialog
    .getByRole("button", { name: "Create and start", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "another-name created" }),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      "Container created, but Docker could not confirm its start.",
    ),
  ).toBeVisible();
  await expect(dialog.getByText("Storage warning")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1].start).toBe(true);
  expect(control.runtimeErrors).toEqual([]);
});

test("mobile creation fits the viewport and cancel sends no request", async ({
  page,
}) => {
  const control = await mockDashboard(page);
  let creations = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/containers"
    )
      creations++;
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await openContainers(page);
  await page
    .getByRole("button", { name: "Create container", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add port" }).click();
  await expect(dialog.getByLabel("Host IP 1", { exact: true })).toBeVisible();
  const overflow = await dialog.evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1,
  );
  expect(overflow).toBe(false);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(creations).toBe(0);
  expect(control.runtimeErrors).toEqual([]);
});

for (const role of ["viewer", "operator"])
  test(`${role} has no container creation control`, async ({ page }) => {
    const control = await mockDashboard(page, "healthy", role);
    await page.goto("/");
    await openContainers(page);
    await expect(
      page
        .getByText("nginx", { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create container", exact: true }),
    ).toHaveCount(0);
    expect(control.runtimeErrors).toEqual([]);
  });

test("creation validates environment and reports a missing local image", async ({
  page,
}) => {
  await mockDashboard(page);
  let calls = 0;
  await page.route("**/api/v1/containers", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    calls++;
    return route.fulfill({
      status: 422,
      json: {
        error:
          "image is not available locally; pull it on the Docker host before creating the container",
      },
    });
  });
  await page.goto("/");
  await openContainers(page);
  await page
    .getByRole("button", { name: "Create container", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Container name", { exact: true })
    .fill("new-service");
  await dialog.getByLabel("Image", { exact: true }).fill("missing:latest");
  await dialog.getByLabel("Environment variables").fill("A=1\nA=2");
  await dialog
    .getByRole("button", { name: "Create container", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Use one NAME=value per line with unique variable names.",
  );
  expect(calls).toBe(0);
  await dialog.getByLabel("Environment variables").fill("A=1");
  await dialog
    .getByRole("button", { name: "Create container", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "image is not available locally",
  );
  expect(calls).toBe(1);
});
