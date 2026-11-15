# Codex Handoff

Baseline reviewed 2026-11-12 on `develop`, commit `ece1b7a`. The current terminal work is on `feature/terminal-redesign`; check the branch before continuing. Do not switch to historical `capacitor-native` or `feature/project-foundation` branches based on older instructions.

## Read and resume

Read the five documents in `AGENTS.md` order, then [module instructions](modules/README.md), [security findings](security.md) and [modularization plan](modularization-plan.md). The user requested documentation first, followed by gradual code implementation and preservation of the Figma UI.

## Authorized Android cleanup

The user explicitly authorized cleanup of the 36 previously untracked Android files after the terminal commit. All 36 were copied and SHA-256 verified outside the repo under `/tmp/coreops-android-cleanup-05romax3/` (temporary storage). Removed 34 unused/conflicting Capacitor template files; retained and versioned two reviewed `.gitignore` files, including exclusions for local signing keys. No previously tracked native code/resources changed, no `cap sync` and no app/security redesign. Do not restore the template resources merely because older handoffs said to preserve them.

Validation: frontend build passed; XML/Kotlin resource references resolve, no duplicate resource IDs, backup hashes verified and ignore rules cover generated/local files without hiding tracked source. Android assemble could not start: Java/JAVA_HOME missing and no Android SDK configured. See [mobile guide](modules/mobile.md). Native build/device validation remains pending.

## Latest terminal slice (2026-11-13)

The explicit terminal request replaces the isolated-command UI with xterm.js and a real Linux PTY. Branch `feature/terminal-redesign` was already checked out; it was preserved. Backend transport is `terminal_session.go`; frontend remains `views/TerminalView.tsx` with shared API transport and new terminal CSS. No wholesale module extraction. See [terminal module](modules/terminal.md) for protocol, environment, limits, lifecycle, shortcuts and proxy configuration.

Validated: Go race tests/vet/build; frontend format/build; 18 fixture browser tests; real Chromium → isolated API → PTY including `top`, state, signals, independent tabs, resize, >45 s and logout. Credentials/data/shell wrapper for live validation were temporary, with no personal history files or Docker mutations. No deployment or native build. A pre-existing typo in testify’s go.mod checksum was corrected after authenticating the canonical value through Go’s official proxy/sum database; integrity checking was retained.

The frontend keeps shells mounted when navigating. Page reload/disconnect ends them; there is no resumable server session or replay. Lifecycle audit redacts content; legacy exec also redacts commands, but its old environment/output limits still need hardening. CLI/server identity coherence SEC-01 remains unresolved. This upgrades the existing admin shell capability, without adding host privileges or implementing a Linux-user identity mapping.

## Terminal disconnect repair

The active development API on 8082 was an older `go run` binary without `/terminal/session`; it returned 404 and the UI rendered a generic disconnect. Rebuilt/restarted that development process with its existing environment, working directory and identity files. The running corrected binary/log/PID are under `/tmp/coreops-terminal-fix/`; the prior binary was retained there for rollback. Future Go edits require a new build/restart; no systemd service was installed.

Vite now preserves Host (`changeOrigin: false`). Verified 101 upgrades through localhost, LAN and Tailscale; an untrusted Origin still receives 403. Authenticated GET without upgrade returns admin-only capability JSON and starts no PTY. The frontend checks that before mounting xterm, explains outdated backend/404, permits retry and distinguishes failed upgrade from later disconnection. Real Chromium → Vite → isolated API → default login bash verified hostname prompt and commands. Go terminal race tests/vet/build and frontend format/build passed; the browser suite now has 20 passing tests including the two regressions. No existing user/password/session data changed.

## Latest UI slice (2026-11-13)

The user expanded the rounded monochrome styling to all application screens and requested configurable accents and responsive mobile/tablet/laptop/desktop layouts. `.app-workspace` now covers the whole app and login. `lib/appearance.ts` owns palette/contrast policy; `webSettings.ts` persists `accentColor`; `tokens.ts` applies live CSS variables. Settings has eight presets plus custom color and preserves the active view on Save/Reset. Semantic status colors remain independent. See [UI style](ui-style.md).

Existing route and operation behavior remains. Keep the current working tree, including unrelated prior documentation/native assets, intact. Default native chrome is aligned with neutral colors but does not mirror web accent/light preferences; no native build was performed.

Validation commands: `pnpm --dir frontend build`, `pnpm --dir frontend format:check`, `pnpm --dir frontend test:ui` (Chromium required). The suite has 15 tests, including every navigation screen and inspect at eight viewports, plus appearance persistence, System, invalid stored color, gaps, stale data, roles and actions. API calls, including terminal identity lookup, are intercepted in these tests. Live API/device integration remains to be verified separately.

## Actual implementation

React/Vite web UI and Capacitor shells call `/api/v1`; Go API binds `127.0.0.1:8082` by default and owns Docker/Linux/libvirt access. Backend remains one `package main`; frontend API transport, types and mapping remain concentrated in `lib/api.ts`. Proposed modules are not extracted yet.

Container list/inspect/start/stop/restart already exist; the prior milestone records manual validation on Ubuntu Docker. Host, applications, services, VMs, storage, network, monitoring, logs, terminal, security and updates have implementations with uneven real integration validation. Aggregate logs and metrics already use Docker. Never repeat production mutations merely to re-prove historical milestones.

Sessions, PBKDF2 passwords, viewer/operator/admin roles, login pair lockout and file audit exist. They need hardening, not initial implementation. Updated CLI/server binaries reload locked identity files per operation; use the same service user/data directory and stop older binaries before upgrading. See SEC-01 and the 2026-11-15 follow-up below. Terminal now has an admin-only persistent PTY/WebSocket with session revalidation and bounded flow control, alongside the legacy isolated exec/complete endpoints. It uses the service account’s host privileges; see [terminal guide](modules/terminal.md). Token storage is localStorage; Android allows cleartext/backup. See the complete security register before extending privileged flows.

## Recommended next slice

SEC-01 is corrected for updated binaries through file locking, reload and revocation ordering; see the identity follow-up below. Next capture auth/health/containers API contracts, including creation, and extract the containers backend slice: consumer-owned interface, Docker adapter, HTTP mapping and composition. Preserve current URLs, JSON behavior and minimum roles. Follow with the frontend containers feature, honest unavailable values and action-flow tests. Remaining P0 risks must precede broader exposure.

Do not do a repository-wide move. Do not introduce microservices or multiple Go modules. Do not generate clients until a contract/tooling decision has been reviewed. New guide per extracted capability should live beside its code and be indexed from the module map.

## Validation completed in this review

- `cd backend && go test ./... && go vet ./... && go build ./...`: passed.
- `cd frontend && pnpm build`: passed, no chunk-size warning.
- No live API, Docker mutation, privileged host command, browser test, native build, dependency audit or deployment was performed.

The earlier untracked Android resources/tests were subsequently cleaned with explicit authorization; see the cleanup section above. CI builds `backend/scp-api`, but the unit starts `/opt/coreops/coreops-api`; installation/frontend delivery remains unresolved. `toContainer` currently sets restart count to zero without source data, and the UI displays it: fix rather than claim all unavailable values are honest.

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

## File explorer handoff

`feature/file-explorer` was based on `main` and is now merged into `develop`, preserving the current UI and interactive terminal. See `backend/README.md#file-explorer` for configuration, API behavior, permissions and native build steps. The feature is isolated in `files.go` / `files_test.go`, `lib/files.ts`, `views/FileExplorerView.tsx`, scoped `styles/files.css` and the Android `CoreOpsFilesPlugin.kt`.

To try the integrated version on the server, check out `develop`, run the existing Go and pnpm validation commands, then start the API and frontend as usual. Default filesystem root is `/`, limited by the service user's permissions. For a smaller shared area set `COREOPS_FILES_ROOT` to an existing directory. Test mobile upload/download using disposable files before rebuilding/installing the Android app.

Merge validation (2026-11-15): Go race tests/vet/build and web format/build; browser fixtures cover Files at eight screen sizes, updated sidebar order and persistent file directory alongside terminal tabs. Native build/device validation remains pending.

Files has its own Suspense boundary inside the screen: loading its lazy chunk must not suspend the mounted terminal and restart its WebSocket sessions. The navigation regression test opens Files after two terminals, enters a folder and verifies both terminal connections and the file path survive repeated screen changes.


## Identity persistence — 2026-11-15

SEC-01 prerequisite: `auth_persistence.go` adds permanent flock + fresh JSON reads to every CLI/server auth operation. Login revalidates hash/role after PBKDF2; user changes revoke first; logout reports storage errors. Existing JSON/hash formats are unchanged. Run only updated binaries with the same service account/local data directory; stop older binaries before upgrade, never unlink `.identity.lock` while running. See [identity guide](modules/identity-audit.md). Historical handoff sections above describe the earlier state.

## Container creation — 2026-11-15

Implemented on `develop` after the Files merge. `container_create.go` and `components/CreateContainerDialog.tsx` connect the existing Containers button to admin-only POST creation with local images, validated configuration and explicit partial start success. Contract/limits: [backend README](../backend/README.md#container-creation). The dialog refreshes real inventory and opens inspection; default is create without start. No image pulling, registry auth, mounts or arbitrary Docker configuration.

Go race/vet/build and web format/build passed; all 26 browser fixture tests passed. Real Chromium tested create→inspect through an isolated API and live Docker; a second disposable container tested optional start. Both containers were removed. The current development API must be rebuilt/restarted when changing Go; production/native deployment is separate.

The development API on 8082 was rebuilt/restarted with the integrated branch, preserving its environment, working directory and unchanged users/session files. Binary: `/tmp/coreops-container-create-api`; log/PID: `/tmp/coreops-container-create-run/`. The Vite frontend remains on 5173 and the create/terminal/files routes are available through LAN/Tailscale. Temporary validation identity data and the isolated API were cleaned up. Creation and identity are recorded in separate commits on `develop`.


## Delete container repair — 2026-11-15

The existing Delete menu was a placeholder that only displayed “Deleted”. It now calls admin-only `DELETE /api/v1/containers/{id}` through `lib/api.ts`. `container_delete.go` validates ID/no query/no body and calls Moby with force/volume/link removal disabled; active-state conflicts return 409. Deletion always requires explicit confirmation. The list tracks pending mutations per ID, removes confirmed rows/selection, refreshes inventory and persists errors even with notifications disabled. Mobile context-menu placement is bounded. [Contract](../backend/README.md#container-deletion).

Validation: full Go tests/vet/build, targeted deletion race tests and web format/build; fixture tests cover delete success/pending/cancel, required confirmation, running state, failures and roles/mobile. Real mobile Chromium deleted a disposable container through an isolated API. Running deletion was refused without stopping it; named and anonymous volumes survived, including marker data. The test resources/temporary identity were cleaned up. Creation/identity changes are preserved in their own commits; production/native deployment is separate.

Development API rebuilt/restarted on 8082 with the same environment/data and unchanged user/session files. Binary `/tmp/coreops-container-delete-api`, log/PID `/tmp/coreops-container-delete-run/`. DELETE is reachable through Vite 5173 and Tailscale and rejects anonymous requests before Docker. The repair is recorded in its own commit on `develop`.

Final browser run: 34/34 passed. Earlier runs saw transient Chromium `ERR_NETWORK_CHANGED` module-load failures on creation/terminal screens; the full rerun passed without needing a test retry (`--retries=1` was available for infrastructure flakes). Go full tests/vet/build and targeted DELETE race tests passed.


## Dozzle-inspired logs — 2026-11-15

Implemented on the same `develop` worktree after the identity/create/delete changes. Logs recreates the installed Dozzle reading layout using CoreOps themes: source sidebar, up to eight tabs, comparison, dense rows, search/case/exclusion/levels, JSON expansion, copy/download, wrap/time/font options and focus mode. Containers menu/inspect now open the actual source. `LogsView.tsx`, `components/LogPane.tsx`, `lib/logs.ts`, scoped CSS and backend `logs.go` own the slice. Read [Logs](modules/logs.md) before continuing.

New targeted container and system-only snapshot routes retain operator permissions. Bounded, cancellable polling replaces full-host collection when selecting a container. Timestamp/whitespace/stream parsing was corrected; no fabricated event timestamps. Pause actually suspends reads; failed refresh keeps explicitly stale data and errors. Lazy Logs has its own Suspense boundary to preserve terminals.

Go race/vet/build, frontend format/build and all 42 fixture tests passed, with scoped reruns after visual/escape-parser refinements. Real Chromium used an isolated operator identity/API to read actual Dozzle container logs, matching Docker CLI timestamps/messages/streams and checking polling/pause, themes and mobile. No infrastructure mutation or native build. Temporary credentials/API are cleaned up; screenshots remain temporary artifacts under `/tmp`.

Development API rebuilt/restarted on 8082 with the existing environment/data, unchanged users/session files and all existing capabilities. Binary `/tmp/coreops-logs-api`; log/PID `/tmp/coreops-logs-run/`. Vite 5173 and Tailscale expose the new authenticated routes. Changes are recorded as separate local feature commits on `develop`.
