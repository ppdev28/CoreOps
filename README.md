<div align="center">

# CoreOps

**A self-hosted control plane for servers, containers and infrastructure.**

CoreOps brings day-to-day infrastructure operations into one focused web interface, combining the ideas of tools such as Cockpit and Portainer with a broader roadmap for DevOps, Sysadmin, SRE and homelab workflows.

<p>
  <img src="https://img.shields.io/badge/status-active%20development-0f766e?style=for-the-badge" alt="Active development" />
  <img src="https://img.shields.io/badge/frontend-React%2019-61dafb?style=for-the-badge&logo=react&logoColor=111827" alt="React 19" />
  <img src="https://img.shields.io/badge/backend-Go%201.24-00ADD8?style=for-the-badge&logo=go&logoColor=white" alt="Go 1.24" />
  <img src="https://img.shields.io/badge/container-Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
</p>

</div>

---

## What is CoreOps?

**CoreOps** is a self-hosted infrastructure control panel designed to be a practical operational workstation rather than a collection of disconnected admin pages.

The goal is simple:

> **One place to understand, operate and troubleshoot your infrastructure.**

CoreOps is being built around real infrastructure data and real operational actions. The project currently targets a single Linux server first, while its architecture leaves room for multi-node infrastructure and future Kubernetes/cloud integrations.

## Current capabilities

The repository already contains UI and backend verticals for several infrastructure areas. The most mature real integration is Docker.

| Area | Current state | What CoreOps provides |
| --- | --- | --- |
| **Dashboard** | 🟢 UI | Infrastructure overview and operational entry points |
| **Host** | 🟢 Backend + UI | Host/system information |
| **Containers** | 🟢 **Real integration** | Discover, inspect, start, stop and restart Docker containers |
| **Applications** | 🟢 Backend + UI | Application-level grouping and lifecycle actions |
| **Services** | 🟢 Backend + UI | Discover and manage system services |
| **Virtual Machines** | 🟢 Backend + UI | VM discovery and lifecycle actions |
| **Storage** | 🟢 Backend + UI | Storage/filesystem information |
| **Network** | 🟢 Backend + UI | Network information and operational context |
| **Monitoring** | 🟢 Backend + UI | Host/container monitoring data |
| **Logs** | 🟢 Backend + UI | Centralized operational log view |
| **Terminal** | 🟡 In progress | Web terminal interface and command execution foundation; persistent PTY/WebSocket terminal is planned |
| **Security** | 🟢 Backend + UI | Security/session information and selected remediation actions |
| **Updates** | 🟢 Backend + UI | Update discovery, refresh and application workflow |
| **Authentication / authorization** | 🔴 Planned | Secure access control for privileged operations |
| **Multi-host / nodes** | 🔴 Planned | Manage multiple servers from one control plane |
| **Kubernetes / cloud** | 🔴 Planned | Future integrations beyond the initial Linux/Docker focus |

> **Real data over decorative data:** areas that do not yet expose complete real infrastructure data are intentionally treated as work in progress rather than presenting fabricated metrics or states.

## Technology stack

### Frontend

- **React 19** — component-based UI
- **TypeScript 5.7** — strict typed frontend development
- **Vite 8** — development server and production bundling
- **Tailwind CSS 4** — utility-first styling
- **Lucide React** — interface icons
- **Recharts 3** — charts and operational visualizations
- **pnpm 10** — JavaScript package management

### Backend

- **Go 1.24** — backend/API runtime
- **net/http** — HTTP API and routing
- **Moby Docker client** — Docker Engine integration
- **Docker Engine** — current primary infrastructure integration
- Linux host APIs/tools where appropriate for host, service, storage, networking and operational data

### Architecture

CoreOps follows a deliberately simple boundary between the browser and privileged infrastructure:

```text
┌──────────────────────────────┐
│          CoreOps Web UI          │
│     React + TypeScript       │
│   Vite + Tailwind + Charts    │
└──────────────┬───────────────┘
               │ HTTP / API
               ▼
┌──────────────────────────────┐
│          CoreOps API             │
│             Go               │
│     Domain / host layer      │
└───────┬───────────┬──────────┘
        │           │
        ▼           ▼
┌────────────┐  ┌────────────────┐
│ Docker     │  │ Linux / Host   │
│ Engine     │  │ services/tools │
└────────────┘  └────────────────┘
```

The browser does **not** talk directly to Docker Engine, the Docker socket, systemd or host filesystems. Privileged infrastructure access belongs behind the Go backend.

## Docker integration

The current proven end-to-end workflow is:

```text
Browser
  ↓
React / Vite
  ↓
/api
  ↓
Go CoreOps API
  ↓
Moby Docker client
  ↓
Docker Engine
  ↓
Real containers
```

The API currently supports Docker health, container discovery and container lifecycle operations including:

- list containers
- inspect a container
- start
- stop
- restart

The frontend reconciles actions with real Docker state and does not fabricate unavailable values.

## Terminal

CoreOps includes a dedicated Terminal view and a backend command-execution foundation. The current implementation is intentionally being evolved toward a full browser terminal rather than pretending that a command/response UI is equivalent to a native terminal.

The planned terminal architecture is:

```text
Browser
  ↓
xterm.js
  ↓
WebSocket
  ↓
CoreOps backend
  ↓
Real PTY
  ↓
bash / zsh / shell
  ↓
Linux host
```

The target experience is comparable to a native terminal such as Ghostty, iTerm2 or GNOME Terminal while remaining integrated into CoreOps.

## Design philosophy

CoreOps is guided by a few principles:

- **Operational clarity** — quickly understand what is healthy, failing or consuming resources.
- **Information density without chaos** — infrastructure tools need detail; hierarchy and progressive disclosure keep it usable.
- **Real data** — unavailable data is shown as unavailable rather than invented.
- **Fast paths for experts** — routine operations should require as few steps as possible.
- **Explicit actions** — destructive or disruptive operations should be clear and appropriately confirmed.
- **Safe by default** — least privilege, authentication, authorization and auditability are part of the product design.
- **Responsive from the beginning** — operational checks should remain useful on mobile as well as desktop.
- **Consistent UX** — similar infrastructure concepts should behave consistently throughout the application.

The current visual language originated in Figma Make and is being preserved as the product implementation evolves. CoreOps should feel like a professional infrastructure workstation, not a generic admin template.

## Getting started

### Requirements

- Linux/macOS/Windows development environment capable of running the project
- Node.js compatible with the current Vite/React toolchain
- **pnpm 10**
- **Go 1.24+**
- Docker Engine for the real container integration

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

For a production build:

```bash
pnpm build
```

The Vite development server proxies `/api` requests to the CoreOps backend on port `8082` by default.

### Backend

```bash
cd backend
go mod tidy
go run ./cmd/CoreOps-api
```

The API listens on `:8082` by default. Override it with:

```bash
CoreOps_PORT=8080 go run ./cmd/CoreOps-api
```

The backend uses the standard Docker environment and can connect to the local Docker Engine through its Unix socket on a normal Linux Docker host.

### Health check

Once the backend is running:

```bash
curl http://localhost:8082/api/v1/health
```

A healthy Docker-enabled host returns a response equivalent to:

```json
{"status":"ok","docker":"available"}
```

## Repository structure

```text
CoreOps/
├── frontend/          # React + TypeScript web application
│   ├── src/components # Shared UI components
│   ├── src/views      # Product views
│   └── src/lib        # API, types, data and utilities
│
├── backend/           # Go API and infrastructure integrations
│   └── cmd/CoreOps-api/   # CoreOps API server
│
├── docs/              # Product, architecture and development docs
├── AGENTS.md          # Development/Codex project instructions
└── README.md
```

## API surface

The backend currently exposes operational endpoints covering:

- health
- host information
- containers and container lifecycle
- applications
- virtual machines
- services
- storage
- networking
- monitoring
- logs
- terminal execution and completion
- security
- updates

The API is intentionally kept behind the CoreOps backend boundary so that infrastructure implementations can evolve without coupling the frontend directly to Docker or Linux APIs.

## Roadmap

CoreOps is being developed in vertical slices rather than attempting to implement the entire infrastructure vision at once.

### Near term

- Expand real Docker inspection, logs and operational details
- Complete the real browser terminal with persistent PTY/WebSocket sessions
- Improve host, services, storage, networking and monitoring integrations
- Strengthen error handling and operational feedback
- Establish authentication, authorization and auditability foundations

### Longer term

- Multiple hosts/nodes
- Richer container orchestration workflows
- Advanced monitoring and alerts
- Filesystem and file operations
- Automation and scheduled tasks
- Configuration/environment management
- Kubernetes integration
- Selected cloud infrastructure integrations

## Development

The project favors small, reviewable vertical slices:

1. Identify a useful operational workflow.
2. Implement the backend capability.
3. Expose a small, stable API surface.
4. Connect the existing UI.
5. Test against real infrastructure.
6. Improve error handling and security.
7. Move to the next workflow.

Before submitting a change, validate the relevant frontend build and backend tests/builds. Do not add fake infrastructure data merely to make a screen look complete.

## Project status

🚧 **Early active development**

CoreOps is functional enough to operate against a real Docker host, but it is not yet a production-ready infrastructure control plane. Authentication, authorization, audit logging, hardened deployment and multi-host support remain part of the roadmap.

---

<div align="center">

**Server Control Center — one place to understand, operate and troubleshoot your infrastructure.**

</div>
