# Linux power adapter

Implements `hostpower.Provider` through fixed logind capability queries and
systemctl actions. Runs bounded commands with a minimal environment and no
shell. Uses an optional root-owned restricted helper through noninteractive
sudo; otherwise preserves direct host permissions. Unknown capabilities never
enable actions. Does not install privileges, bypass inhibitors or verify
completion after command acceptance.

Tests inject the runner: never call real poweroff, reboot or suspend in tests.
See [setup and contracts](../../../../docs/modules/host-power.md).
