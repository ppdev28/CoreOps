# Host security core

Evidence-based checks, SSH session identity validation and verified APT timer changes. `Source` is implemented by `internal/adapters/linuxsecurity`; the core has no process, HTTP or infrastructure SDK dependency. Missing evidence remains unknown. HTTP/auth/audit composition stays in `cmd/coreops-api`.

See [module guide](../../../docs/modules/host-security.md) for permissions, contracts, host limitations and validation. `go test -race ./internal/security ./internal/adapters/linuxsecurity` exercises decisions and adapters without touching user sessions. The separately opt-in SSH lifecycle test starts its own loopback server.
