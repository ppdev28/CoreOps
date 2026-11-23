#!/bin/sh
# No host mutations; fail on known reachable Go or moderate+ npm advisories.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
(cd "$root/backend" && go run golang.org/x/vuln/cmd/govulncheck@v1.10.0 ./...)
(cd "$root/frontend" && pnpm audit --audit-level=moderate)
