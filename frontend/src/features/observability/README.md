# Observability feature

`ObservabilityView.tsx` coordinates snapshots and selection; `context.ts` owns
URL context; `api.ts` uses the shared authenticated client; `model.ts` contains
CoreOps DTOs/formatting; `Chart.tsx` renders Recharts with finite values, null gaps,
units, calculation details and a shared zoom interval. Screen CSS uses CoreOps
palette variables and isolates compact mobile cards from existing views.

Entry: lazy screen in App, plus shell/Android navigation. Server metadata/sources
stay behind CoreOps; the browser sends only catalog metric IDs, bounded exact
filters and seconds-based windows. Only returned Grafana links target the public
Grafana URL. There is no direct browser Prometheus client or embedded dashboard.

Navigation restores `view=observability` and all `obs_*` context parameters. Data
is cancelled on scope changes; polling and refresh preserve the last successful
samples while showing errors/staleness. Active alerts are current snapshots;
recovery is shown only after a successful query for the matching resource.

Validation: `pnpm check:boundaries`, `pnpm build`, `pnpm test:ui`.
See [operation and limitations](../../../../docs/observability.md).
