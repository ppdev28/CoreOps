# Development Workflow

## Development environment

The primary development/integration environment is an Ubuntu Server host running Docker directly.

Repository path on that host:

```bash
~/proyectos/CoreOps
```

The developer also works from a Mac and can access the server through Tailscale. The mobile client is useful for responsive and remote-access testing.

## Frontend

Use pnpm, not npm.

```bash
cd ~/proyectos/CoreOps/frontend
pnpm install
pnpm build
pnpm dev --host 0.0.0.0
```

The frontend normally runs on port `5173`.

When Vite is started with `--host 0.0.0.0`, it exposes the application on the server's reachable interfaces. Prefer testing over the intended private/Tailscale network rather than exposing the development server to the public Internet.

## Backend

```bash
cd ~/proyectos/CoreOps/backend
go mod tidy
go build ./...
go run ./cmd/coreops-api
```

The API normally listens on `127.0.0.1:8082`. Create a user first (see `backend/README.md`), for example:

```bash
COREOPS_ADMIN_USER=admin COREOPS_ADMIN_PASSWORD='a-long-password' go run ./cmd/coreops-api
```

Run `go test ./...` and `go vet ./...` before committing backend changes.

## Basic backend checks

Health:

```bash
curl http://localhost:8082/api/v1/health
```

Containers:

```bash
TOKEN=$(curl -s -d '{"username":"admin","password":"a-long-password"}' http://localhost:8082/api/v1/auth/login | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8082/api/v1/containers
```

When validating Docker integration, the API response should be compared with the actual Docker host state. Do not rely solely on mock data or screenshots.

## Frontend/API integration

The frontend uses the Vite development proxy so browser calls can use `/api/...` while the backend remains on `localhost:8082` on the server.

This avoids putting Docker Engine access into the browser and avoids unnecessary CORS complexity during local development.

## Validation order

For a backend change:

1. `go build ./...`
2. run the API
3. exercise the relevant endpoint with `curl`
4. if relevant, exercise the real Docker operation against a safe test container
5. run the frontend build if the contract changed

For a frontend change:

1. `pnpm build`
2. run the frontend
3. verify the relevant view against the real API
4. test loading/error/empty states
5. test desktop and mobile layout where relevant

For a cross-stack change:

1. validate backend compilation;
2. validate API behavior;
3. validate frontend build;
4. run both services;
5. verify the complete browser -> API -> infrastructure path.

## Git safety

Before making changes:

```bash
git status
git branch --show-current
git pull --ff-only origin feature/project-foundation
```

Do not commit generated files such as:

- `backend/coreops-api`
- build output in `frontend/dist/`
- local environment secrets
- editor-specific files

Use focused commits. Do not squash/rebase/force-push existing work unless explicitly requested.

## Security rules for development

- Never expose `/var/run/docker.sock` directly to a browser.
- Never add a Docker TCP endpoint without authentication and explicit justification.
- Do not put credentials, API tokens, private keys or secrets in source control.
- Treat Docker lifecycle operations as privileged actions.
- Do not add broad CORS rules as a substitute for a proper deployment/authentication design.
- When an operation can destroy data or stop production services, add explicit confirmation and clear error handling.
