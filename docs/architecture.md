# Architecture

## Current direction

CoreOps is being built in vertical slices. The current frontend is the product UI reference, while infrastructure integrations are implemented behind the Go backend.

```text
React UI
   |
   v
CoreOps API client / application services
   |
   +---- mock data (until a feature is connected)
   |
   +---- HTTP / WebSocket API
                 |
                 v
              Go backend
                 |
       +---------+---------+---------+
       |                   |         |
     Docker             Linux    Metrics   Network
```

The UI follows the product design generated in Figma Make. We deliberately keep the first implementation close to that UI instead of freezing a large domain model up front. Contracts can evolve when real workflows expose better requirements.

## Backend boundaries

The backend is responsible for infrastructure access and should keep Docker Engine, systemd, filesystem, networking and Linux metrics details out of the browser.

The first implemented adapter is Docker. It currently exposes container discovery, inspection and basic lifecycle actions through `/api/v1/containers`.

```text
HTTP handler
    |
    v
Container operations
    |
    v
Docker SDK
    |
    v
Docker Engine /var/run/docker.sock
```

The Docker socket is a highly privileged interface. It should not be exposed directly over TCP. In the initial self-hosted deployment CoreOps is expected to run on the same Linux host as Docker and be reached through a trusted private network such as Tailscale.

## Frontend boundaries

- `components/` contains reusable visual components.
- `views/` contains the route-level product screens generated from the UI design.
- `lib/` contains UI tokens, data and shared types.
- infrastructure access belongs behind API/service boundaries rather than directly in visual components.

## Future direction

The product is intended to grow from a single Linux/Docker host into a broader infrastructure control plane. Possible future integrations include Linux services, storage, networking, monitoring, logs, multiple nodes, remote agents, Kubernetes and cloud providers.

Those integrations should be added incrementally from real user workflows rather than by prematurely defining a large abstraction hierarchy.
