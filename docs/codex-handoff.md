# Codex Handoff

Baseline reviewed 2026-11-12 on `develop`, commit `ece1b7a`. The current UI work is on `feature/ui-redesign`; check the branch before continuing. Do not switch to historical `capacitor-native` or `feature/project-foundation` branches based on older instructions.

## Read and resume

Read the five documents in `AGENTS.md` order, then [module instructions](modules/README.md), [security findings](security.md) and [modularization plan](modularization-plan.md). The user requested documentation first, followed by gradual code implementation and preservation of the Figma UI.

## Latest UI slice (2026-11-13)

The user expanded the rounded monochrome styling to all application screens and requested configurable accents and responsive mobile/tablet/laptop/desktop layouts. `.app-workspace` now covers the whole app and login. `lib/appearance.ts` owns palette/contrast policy; `webSettings.ts` persists `accentColor`; `tokens.ts` applies live CSS variables. Settings has eight presets plus custom color and preserves the active view on Save/Reset. Semantic status colors remain independent. See [UI style](ui-style.md).

Existing route and operation behavior remains. Keep the current working tree, including unrelated prior documentation/native assets, intact. Default native chrome is aligned with neutral colors but does not mirror web accent/light preferences; no native build was performed.

Validation commands: `pnpm --dir frontend build`, `pnpm --dir frontend format:check`, `pnpm --dir frontend test:ui` (Chromium required). The suite has 15 tests, including every navigation screen and inspect at eight viewports, plus appearance persistence, System, invalid stored color, gaps, stale data, roles and actions. API calls, including terminal identity lookup, are intercepted in these tests. Live API/device integration remains to be verified separately.

## Actual implementation

React/Vite web UI and Capacitor shells call `/api/v1`; Go API binds `127.0.0.1:8082` by default and owns Docker/Linux/libvirt access. Backend remains one `package main`; frontend API transport, types and mapping remain concentrated in `lib/api.ts`. Proposed modules are not extracted yet.

Container list/inspect/start/stop/restart already exist; the prior milestone records manual validation on Ubuntu Docker. Host, applications, services, VMs, storage, network, monitoring, logs, terminal, security and updates have implementations with uneven real integration validation. Aggregate logs and metrics already use Docker. Never repeat production mutations merely to re-prove historical milestones.

Sessions, PBKDF2 passwords, viewer/operator/admin roles, login pair lockout and file audit exist. They need hardening, not initial implementation. CLI changes are not reloaded by the running auth store; stop the API before CLI user changes and use the same service user/data directory. See SEC-01. Terminal is admin-only shell execution with process privileges, not a persistent PTY. Token storage is localStorage; Android allows cleartext/backup. See the complete security register before extending privileged flows.

## Recommended next slice

Fix coherent identity persistence and revocation (SEC-01) with behavior tests for CLI/server, restart and storage failures. Choose persistence deliberately; SQLite is a candidate, not a completed decision. Then capture auth/health/containers API contracts and extract the containers backend slice: consumer-owned interface, Docker adapter, HTTP mapping and composition. Preserve current URLs, JSON behavior and minimum roles. Follow with the frontend containers feature, honest unavailable values and action-flow tests. Remaining P0 risks must precede broader exposure.

Do not do a repository-wide move. Do not introduce microservices or multiple Go modules. Do not generate clients until a contract/tooling decision has been reviewed. New guide per extracted capability should live beside its code and be indexed from the module map.

## Validation completed in this review

- `cd backend && go test ./... && go vet ./... && go build ./...`: passed.
- `cd frontend && pnpm build`: passed, no chunk-size warning.
- No live API, Docker mutation, privileged host command, browser test, native build, dependency audit or deployment was performed.

Untracked Android resources/tests existed before this task; keep them untouched. CI builds `backend/scp-api`, but the unit starts `/opt/coreops/coreops-api`; installation/frontend delivery remains unresolved. `toContainer` currently sets restart count to zero without source data, and the UI displays it: fix rather than claim all unavailable values are honest.

## Commands for the next session

```bash
git status --short
git branch --show-current
git log --oneline -5
cd backend
go test ./...
go vet ./...
go build ./...
cd ../frontend
pnpm build
```

Before finishing a slice, inspect scope/diff, run relevant checks, update current state and module guide, and report what changed, what was tested, what remains and how to continue. The user has now requested committing the documentation and UI work after completing the favicon. No deployment or push was requested.
