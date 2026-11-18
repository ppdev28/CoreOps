# Host power

Domain service for the three explicit power actions. Depends only on a
`Provider` port. Confirms live hostname/boot identity and capabilities, serializes
requests, retains uncertain outcomes for replay and runs the transport's
authorization/audit guard immediately before dispatch. No HTTP, commands,
authentication store or infrastructure SDK imports.

Admin policy and JSON validation live in `cmd/coreops-api/host_power.go`;
`adapters/linuxpower` owns fixed OS calls. Tests never execute real power actions.
See [operation, privileges and limitations](../../../docs/modules/host-power.md).

Validation: `go test -race ./internal/hostpower ./internal/adapters/linuxpower`
and `go test -race ./cmd/coreops-api -run 'TestPower'` from `backend/`.
