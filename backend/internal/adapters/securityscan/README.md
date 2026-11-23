# Local vulnerability scanner adapter

`Trivy` implements `security.Scanner`. The browser supplies only `host` or an
immutable SHA-256 ID from the current image inventory. The adapter rechecks image
existence and forces the local Docker source; no image pulls or container actions.

Host scanning copies only distribution metadata (`os-release`, `lsb-release`,
`debian_version`) and dpkg status into a private temporary rootfs. It does not walk
user files. Ubuntu detection requires lsb-release: a missing/unsupported package
inventory fails and is never returned as a clean report. This assesses supported
OS packages, not all third-party software or the currently loaded kernel alone.

The executable must be an absolute regular file owned by root/the service user,
without group/world write; its directory ancestry is checked too. No shell,
plugins, browser-selected paths, proxy credentials or inherited CoreOps secrets.
A minimal environment, fixed argv/config, timeout and bounded stdout/stderr apply.
The process group belongs to this scan and is terminated on timeout/shutdown.

Only explicit report fields are exported; raw image configuration/env/labels and
scanner output are discarded. Report output is bounded at 16 MiB, display at
1,000 findings (severity and published fixes prioritized); counts cover all unique
package/advisory/version tuples, with distinct-advisory and fixable counts separate.
DB freshness, EOL OS, unsupported packages, errors and truncation remain explicit.

See [Security](../../../../docs/modules/host-security.md). Pinned installer:
`deploy/install-security-scanner.py`, run **as the API service user**, not via sudo.
The Trivy tool source uses its own Go toolchain; it is not a project Go dependency.
