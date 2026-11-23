# Host security capability

Evidence checks, SSH identity validation, guarded mutations, detailed posture,
retained journal pagination, bounded correlation and asynchronous CVE jobs.
Infrastructure lives behind Source, PostureSource, EventSource, Scanner and
CheckpointStore ports; no HTTP, exec, Docker SDK or host filesystem imports here.

`MutationGuard` encloses the bounded host effect. HTTP composition holds the
existing identity lock while revalidating admin/session, persisting audit intent
and dispatching; a logout/role update linearizes before or after the operation.
Fresh SSH identity/OS permission/pidfd validation still belongs to the adapter.

The monitor follows forward journal cursors in batches and persists its checkpoint
before advancing. Errors/malformed records/storage failure block advancement;
backlogs continue next cycle. Correlation uses up to 2,000 process-local events:
repeated authentication failures, MAC denials, sensor/signature/integrity messages.
Signals are evidence-based heuristics, never a verdict of compromise or absence.

CVE jobs require fresh host/boot/target, a request ID and an authorization/audit
guard. One runs at a time, with bounded lifetime/history and no automatic retry.
Receipts/results are process-local; shutdown cancels work. Scanner failures never
produce an empty healthy report. Read the module guide for operational coverage.

Tests exercise decisions, paging/cursors, storage failure, replay, unknown state
and dispatch guards with fakes. The separately opt-in loopback SSH test touches
only its own connection. Never signal the user's existing SSH/Tailscale processes.

[Module guide](../../../docs/modules/host-security.md).
