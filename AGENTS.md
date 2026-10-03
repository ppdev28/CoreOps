# CoreOps — Codex Instructions

## Mission

You are working on **CoreOps (CoreOps)**, a self-hosted, professional infrastructure control plane inspired by Cockpit and Portainer, but intentionally aiming beyond both as a practical all-in-one tool for DevOps engineers, sysadmins, SREs and cloud engineers.

The product must feel like a serious operational application, not a dashboard mockup. The UI already has a strong Figma Make design direction; preserve it unless a product decision explicitly requires a change.

## Read first

Before changing code, read these files in this order:

1. `docs/product.md` — product vision, scope and UX principles.
2. `docs/current-state.md` — exact implementation state and the last completed milestone.
3. `docs/architecture.md` — technical boundaries and architecture direction.
4. `docs/development.md` — local development and validation workflow.
5. `docs/codex-handoff.md` — how to resume the work and what to do next.

## Working rules

- Work in small, reviewable vertical slices.
- Prefer real infrastructure over mocks as soon as a feature can be safely exercised against it.
- Do not redesign the Figma UI merely because implementation is easier another way.
- Do not invent infrastructure data. If the backend does not expose a value, represent it as unavailable rather than fabricating it.
- Keep infrastructure concerns in the Go backend. The browser talks to CoreOps APIs, never directly to Docker Engine, `/var/run/docker.sock`, systemd or host filesystems.
- Keep the frontend independent from Docker SDK types. Use explicit API/domain types and adapters.
- Treat API contracts as implementation details that may evolve with the UI; do not build a giant domain model prematurely.
- Security is a first-class requirement: least privilege, authentication, authorization, auditability, safe defaults and protection of privileged interfaces.
- Never expose the Docker socket directly to the browser or over an unauthenticated TCP endpoint.
- Prefer pnpm for JavaScript package management. Do not introduce npm lockfiles.
- Keep TypeScript strict and Go code idiomatic.
- Before declaring a change complete, run the most relevant build/tests and report any warnings or limitations.
- Do not silently change unrelated files.
- Do not commit generated binaries such as `backend/scp-api`.

## Current real environment

The primary integration test host is an Ubuntu Server machine running Docker directly. The repository is located at `~/proyectos/CoreOps` on that server. The developer also has a Mac and a mobile phone connected to the server through Tailscale.

The real Docker host contains many containers, so it is suitable for exercising CoreOps against a non-trivial environment. Do not assume the exact container list is static; query the API/Docker Engine when validating behavior.

## Git workflow

The active development branch for this phase is `feature/project-foundation`.

Keep commits focused and use conventional-style messages such as:

- `feat(backend): add container lifecycle operations`
- `feat(frontend): connect container actions to api`
- `fix(api): handle docker inspection errors`
- `docs: update project handoff`

Do not rewrite history or force-push unless explicitly requested.

## Immediate product rule

The next logical milestone after the current state is to turn container lifecycle actions in the existing UI into real Docker operations (`start`, `stop`, `restart`, etc.) while preserving the existing design and handling loading, confirmation, errors and refresh correctly.
