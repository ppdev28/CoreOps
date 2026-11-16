# Host history capability

Owns `HistorySource`, nullable CPU/memory points and range filtering/deduplication. It uses only stdlib and has no HTTP, SDK or host-command dependency. The sysstat adapter implements the source; cmd composes it and enforces viewer authentication. This is a separate partial monitoring slice; live Docker monitoring remains in cmd.

See [history guide](../../../docs/modules/monitoring-history.md). Tests: `go test -race ./internal/monitoring`; import boundaries are checked by `TestExtractedModuleDependencies`.
