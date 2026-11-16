# Observability capability

Read-only server-owned catalog, filters, bounded time windows, inventory/summary,
active Prometheus rule/alert snapshots, resource detail and Grafana links.
`Source` is the port; `adapters/prometheus` is its HTTP implementation. The package
imports neither HTTP handlers, subprocesses nor infrastructure SDKs.

Viewer/operator/admin use the existing session/role enforcement in `routes.go`.
Prometheus alone evaluates alerts. This module neither modifies infrastructure nor
creates incident transitions. Query failures and unknown values never become zero.

See [module guide](../../../docs/modules/observability.md) and
[installation, formulas, rules and validation](../../../docs/observability.md).
`go test -race ./internal/observability ./internal/adapters/prometheus ./internal/telemetry`.
