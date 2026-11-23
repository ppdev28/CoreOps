# Linux Tailscale LocalAPI adapter

Implements internal/tailscale.Provider with standard Go HTTP over the fixed local
Unix socket. No TCP daemon exposure, cloud API keys, browser-selected URLs or new
SDK dependencies. GET status/preferences are decoded into a whitelist of public
fields; keys, raw preference state and peer public-key maps are discarded.

`check-prefs` is a validation-only POST used to determine daemon write permission.
A readable/world-writable Unix socket does not imply management permission.
Explicit operations use masked PATCH preferences, preserving unspecified fields.
Sign-in preparation is restricted to NeedsLogin; it starts the backend without
replacing preferences, requests running state and starts interactive login.
Only trusted HTTPS sign-in links are exported while login is needed.

The optional restricted root-owned helper is used only after a noninteractive
check confirms it is available. It accepts a bounded JSON action on stdin, not
arbitrary CLI flags or a raw LocalAPI proxy. No automatic sudo or operator grant.
Output, responses, deadlines, read concurrency, errors and redirects are bounded.

See [setup and limits](../../../../docs/modules/tailscale.md). Fake transports and
helper acknowledgements cover requests without touching the real daemon. Live
validation must use only GET and the non-mutating check-prefs endpoint.
