# CoreOps backend

The backend is a small Go HTTP API that exposes CoreOps capabilities without leaking Docker Engine details into the frontend.

## Local development

The API uses Docker's standard environment configuration. On a Linux host with Docker installed directly, the Docker Unix socket is used automatically by the Docker SDK.

```bash
cd backend
go mod tidy
go run ./cmd/scp-api
```

The default API address is `http://localhost:8080`.

Useful endpoints:

- `GET /api/v1/health`
- `GET /api/v1/containers`
- `GET /api/v1/containers/:id`
- `POST /api/v1/containers/:id/start`
- `POST /api/v1/containers/:id/stop`
- `POST /api/v1/containers/:id/restart`

Set `CoreOps_PORT` to change the HTTP port.

## Security

The backend is intentionally designed to talk to Docker through the local Unix socket rather than exposing Docker Engine's TCP API. Access to the Docker socket is highly privileged and must be protected at the host level.

For the first integration, CoreOps is expected to run on the same Ubuntu host as Docker and be reachable remotely through the user's private network (for example Tailscale). Authentication and authorization will be added before CoreOps is exposed beyond a trusted development network.
