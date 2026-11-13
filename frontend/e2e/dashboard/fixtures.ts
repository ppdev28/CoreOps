import type { Page } from "@playwright/test";

export type Mode = "healthy" | "issues" | "empty" | "offline" | "gap";
export async function mockDashboard(
  page: Page,
  initial: Mode = "healthy",
  role = "admin",
) {
  const control = {
    mode: initial,
    samples: 0,
    requests: [] as string[],
    runtimeErrors: [] as string[],
    terminalInputs: [] as string[],
    terminalMessages: [] as Array<Record<string, unknown>>,
  };
  await page.routeWebSocket("**/api/v1/terminal/session", (socket) => {
    socket.onMessage((message) => {
      if (typeof message === "string") {
        const data = JSON.parse(message);
        control.terminalMessages.push(data);
        if (data.type === "auth") {
          socket.send(
            JSON.stringify({
              type: "ready",
              user: "operator",
              host: "homelab-server",
              shell: "/bin/bash",
            }),
          );
          socket.send(Buffer.from("operator@homelab-server:~$ "));
        }
      } else {
        control.terminalInputs.push(message.toString());
        socket.send(message);
      }
    });
  });
  page.on("pageerror", (error) => control.runtimeErrors.push(error.message));
  await page.addInitScript(
    ({ role }) => {
      if (!localStorage.getItem("coreops.session"))
        localStorage.setItem(
          "coreops.session",
          JSON.stringify({
            token: "ui-test-fixture-only",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            user: { name: "Test Operator", role },
          }),
        );
      if (!localStorage.getItem("coreops-web-settings"))
        localStorage.setItem(
          "coreops-web-settings",
          JSON.stringify({
            theme: "dark",
            autoRefresh: false,
            refreshSeconds: 5,
          }),
        );
    },
    { role },
  );
  // Fixtures exist only in tests. Every API call is intercepted; no host is mutated.
  const GiB = 1024 ** 3;
  const host = {
    hostname: "homelab-server",
    os: {
      name: "Ubuntu 24.04 LTS",
      version: "24.04",
      kernel: "6.8.0-test",
      architecture: "x86_64",
    },
    uptimeSeconds: 14 * 86400 + 8 * 3600,
    load: { load1: 0.42, load5: 0.38, load15: 0.35 },
    cpu: { cores: 8, usagePercent: 23 },
    memory: {
      totalBytes: 16 * GiB,
      usedBytes: 7.7 * GiB,
      availableBytes: 8.3 * GiB,
      usagePercent: 48,
    },
    disk: {
      totalBytes: 1000 * GiB,
      usedBytes: 612 * GiB,
      availableBytes: 388 * GiB,
      usagePercent: 61,
    },
  };
  const containers = ["nginx", "postgres", "redis", "nextcloud"].map(
    (name, index) => ({
      id: `abcdef12345${index}`,
      name,
      image: `${name}:stable`,
      state: "running",
      status: index === 0 ? "Up 14 days (healthy)" : "Up 14 days",
      createdAt: 1700000000,
      networks: ["bridge"],
      ports: [],
    }),
  );
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    control.requests.push(path);
    if (
      control.mode === "offline" ||
      (control.mode === "gap" && path === "/monitoring")
    )
      return route.fulfill({
        status: 503,
        json: { error: "Test fixture: capability unavailable" },
      });
    let body: unknown;
    if (path === "/terminal/session") body = { available: true, protocol: 1 };
    else if (path === "/host") body = host;
    else if (path === "/containers")
      body =
        control.mode === "empty"
          ? []
          : containers.map((c, i) =>
              control.mode === "issues" && i === 0
                ? { ...c, status: "Up 14 days (unhealthy)" }
                : control.mode === "issues" && i === 2
                  ? { ...c, state: "restarting", status: "Restarting" }
                  : c,
            );
    else if (path === "/monitoring") {
      control.samples++;
      body = {
        timestamp: await page.evaluate(() => Date.now()),
        host: {
          cpuUsagePercent: 23,
          cores: 8,
          memoryUsedBytes: 7.7 * GiB,
          memoryTotalBytes: 16 * GiB,
          memoryUsagePercent: 48,
          swapUsedBytes: 0,
          swapTotalBytes: 0,
          load1: 0.42,
          load5: 0.38,
          load15: 0.35,
          diskReadBytes: 100,
          diskWriteBytes: 200,
          netRxBytes: 1000000 + control.samples * 10000,
          netTxBytes: 200000 + control.samples * 1000,
        },
        containers:
          control.mode === "empty"
            ? []
            : containers.map((c, i) => ({
                id: c.id,
                name: c.name,
                cpuPercent: [0.4, 1.2, 0.1, 0.8][i],
                memoryUsedBytes: [18, 142, 12, 311][i] * 1024 ** 2,
                memoryLimitBytes: GiB,
                memoryPercent: 2,
                netRxBytes: 0,
                netTxBytes: 0,
                blockReadBytes: 0,
                blockWriteBytes: 0,
              })),
      };
    } else if (path === "/storage")
      body = {
        totalCapacityBytes: 1000 * GiB,
        usedBytes: 612 * GiB,
        availableBytes: 388 * GiB,
        usagePercent: 61,
        disks: [
          {
            device: "/dev/nvme0n1p2",
            model: "NVMe SSD",
            capacityBytes: 1000 * GiB,
            usedBytes: 612 * GiB,
            availableBytes: 388 * GiB,
            usagePercent: 61,
            filesystem: "ext4",
            mount: "/",
            temperature: "Unavailable",
            smart: "Unavailable",
            type: "SSD",
          },
        ],
        volumes: [
          {
            name: "homelab_data",
            driver: "local",
            mountpoint: "/var/lib/docker/volumes/homelab_data/_data",
            sizeBytes: GiB,
            usedBytes: GiB / 2,
          },
        ],
      };
    else if (path === "/network")
      body = {
        interfaces: [
          {
            name: "eth0",
            ip: "192.0.2.10",
            mac: "02:00:00:00:00:01",
            state: "up",
            speed: "1 Gbps",
            rxBytes: 100000,
            txBytes: 10000,
          },
        ],
        ports: [
          {
            port: 22,
            proto: "tcp",
            process: "sshd",
            container: "",
            address: "0.0.0.0",
            state: "LISTEN",
          },
        ],
        topology: {
          gateway: "192.0.2.1",
          host: "192.0.2.10",
          dockerBridge: "172.17.0.1",
          containers: [{ name: "nginx", ip: "172.17.0.2" }],
        },
      };
    else if (path === "/logs")
      body = {
        entries:
          control.mode === "empty"
            ? []
            : [
                "Backup completed",
                "nginx restarted",
                "SSH login detected",
                "System update available",
              ].map((message, i) => ({
                timestamp: new Date(
                  Date.now() - [120, 1080, 3600, 10800][i] * 1000,
                ).toISOString(),
                source: ["backup", "docker", "ssh", "apt"][i],
                level: "info",
                message,
              })),
        sources: ["backup", "docker", "ssh", "apt"],
        updatedAt: new Date().toISOString(),
      };
    else if (path === "/services")
      body = [
        {
          id: "ssh.service",
          name: "ssh.service",
          description: "OpenSSH server",
          status: "active",
          enabled: true,
          cpu: "2s",
          memory: "18 MB",
          uptime: "14d",
        },
      ];
    else if (path === "/applications")
      body = [
        {
          id: "homelab",
          name: "Homelab",
          description: "Compose project",
          status: "running",
          containers: 4,
          version: "—",
          category: "Compose",
          icon: "",
          containerIds: containers.map((c) => c.id),
        },
      ];
    else if (path === "/virtual-machines")
      body = [
        {
          name: "development-server",
          connection: "qemu:///system",
          state: "running",
        },
      ];
    else if (path === "/security")
      body = {
        updatedAt: new Date().toISOString(),
        checks: [
          { label: "Firewall", ok: true, detail: "Active" },
          { label: "SSH", ok: true, detail: "Key authentication enabled" },
        ],
        sessions: [
          {
            user: "operator",
            from: "192.0.2.55",
            since: "10:30",
            method: "ssh",
            pid: 12345,
          },
        ],
        firewallActive: true,
        firewallRules: [
          { number: "1", to: "22/tcp", action: "ALLOW", from: "192.0.2.0/24" },
        ],
        firewallVersion: "0.36",
        events: [
          {
            timestamp: new Date().toISOString(),
            type: "info",
            message: "SSH session opened",
          },
        ],
      };
    else if (path === "/terminal/exec")
      body = {
        output: "operator|homelab-server|/home/operator",
        exitCode: 0,
        cwd: "/home/operator",
      };
    else if (path === "/updates")
      body = {
        updates: [],
        securityCount: 0,
        systemCount: 0,
        updatedAt: new Date().toISOString(),
      };
    else if (path.startsWith("/containers/"))
      body = {
        id: path.split("/").at(-1),
        name: "nginx",
        image: "nginx:stable",
        state: "running",
        created: new Date().toISOString(),
        config: { env: [], cmd: [], entrypoint: [], workingDir: "" },
        mounts: [],
        networks: {},
        ports: {},
        labels: {},
      };
    else
      return route.fulfill({
        status: 503,
        json: { error: "Test fixture: capability unavailable" },
      });
    return route.fulfill({ json: body });
  });
  return control;
}
