# Current State

Last known working milestone: **the Figma-designed Containers UI displays real Docker data and performs tested start, stop and restart operations against the Ubuntu Server Docker Engine**.

## Repository

- GitHub repository: `ppdev28/CoreOps`
- Active branch: `feature/project-foundation`
- The developer also has a local checkout on the Ubuntu server at `~/proyectos/CoreOps`.
- GitHub authentication from the server uses SSH.
- The JavaScript package manager is pnpm.

## Frontend

Stack:

- React
- TypeScript
- Vite
- Tailwind CSS
- Lucide
- Recharts
- pnpm

The frontend lives in `frontend/`.

The UI originated in Figma Make and has been brought into the repository. It contains route-level views, reusable components, shared types, UI data and utility code.

The Containers screen has been connected to the CoreOps API rather than relying on its original mock container list.

The Vite development server proxies `/api` requests to the local backend on port `8080`.

Known frontend validation command:

```bash
cd ~/proyectos/CoreOps/frontend
pnpm install
pnpm build
pnpm dev --host 0.0.0.0
```

The build currently succeeds. Vite may report a chunk-size warning for the main JavaScript bundle; this is not currently a release blocker.

## Backend

Stack:

- Go
- HTTP API
- Moby Docker client

The backend lives in `backend/`.

The API runs on `:8080`.

The backend can connect to the Docker Engine on the Ubuntu host through the normal Docker environment/local Unix socket.

The health endpoint currently works:

```text
GET /api/v1/health
```

Expected shape:

```json
{"docker":"available","status":"ok"}
```

The containers endpoint currently works:

```text
GET /api/v1/containers
```

It returns real Docker containers with fields including IDs, names, images, state/status, creation time, published ports and networks.

The frontend currently adapts this API response to the UI's container model. Values not exposed by the backend are not fabricated. Container start, stop and restart actions call the CoreOps API, show a pending state per container, prevent duplicate submissions and refresh the real Docker state after completion.

## Real integration environment

The primary test host is Ubuntu Server with Docker installed directly on the host, not Docker Desktop.

The developer has a non-trivial real Docker environment containing many containers. Examples seen during development included:

- transmission
- filebrowser
- pairdrop
- Arcane
- homepage
- big-bear-dockhand
- adminer
- cloudbeaver
- Ollama
- big-bear-portainer
- prowlarr
- CouchDB
- radarr
- big-bear-dozzle
- firefly
- flaresolverr
- big-bear-btop
- convertx

Do not hard-code this list. It changes over time and exists only as evidence that the real integration environment is useful for testing.

The developer's Mac and mobile phone can reach the server through Tailscale. This is useful for responsive/mobile testing and remote access testing.

## What has been proven

The following path is working:

```text
Browser
  -> React/Vite UI
  -> /api proxy
  -> Go CoreOps API :8080
  -> Docker Engine
  -> real containers
```

The Containers view now displays real containers from the server.

The lifecycle workflow has also been manually validated against Docker on the Ubuntu Server: start, stop and restart operations update the UI and reconcile with the real container state, including stopping and starting a disposable test container.

## What is not finished

The Containers workflow supports real lifecycle actions through the Go API:

```text
POST /api/v1/containers/{id}/start
POST /api/v1/containers/{id}/stop
POST /api/v1/containers/{id}/restart
```

Stop and restart require confirmation in the UI. The API validates container IDs for lifecycle operations and returns Docker errors to the client. The next Containers milestone should extend the real workflow with inspection, logs, metrics and other operational details rather than simulated actions.

CPU, memory, restart count and other richer operational data may still require additional backend endpoints/inspection/metrics work. Do not fake these values.

Authentication, authorization, audit logging, production deployment, multi-host support and broader infrastructure integrations are future work.

## Important historical issue

The project originally had a Docker SDK compatibility problem. The backend was migrated to the Moby client dependency set and `go mod tidy` produced the required dependency graph. The resulting backend builds/runs successfully.

Do not revert to the old incompatible Docker client dependency merely to simplify imports.
