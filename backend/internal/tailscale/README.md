# Tailscale host management

Domain models and workflow behind a narrow Provider port. No HTTP, Unix sockets,
Tailscale SDK or OS commands. Admin authorization/audit are injected before
execution by transport; the provider owns bounded LocalAPI operations.

A mutation requires explicit OS hostname confirmation and a fresh revision of
host boot identity, node/profile identity, daemon state and preferences. Peer
traffic/health/auth URLs do not change the revision. Validate actions and field
allowlist, reject stale/unsupported targets, serialize submissions and retain
identical request receipts for five minutes (including uncertain outcomes).
A five-second cooldown prevents rapid new requests. Receipts are process-local;
there is no durable exactly-once guarantee or CAS against an external CLI.

See [contracts, permissions and operation](../../../docs/modules/tailscale.md).
Test with `go test -race ./internal/tailscale ./internal/adapters/tailscalelocal`
from backend. Tests use simulated providers and never change the host tailnet.
