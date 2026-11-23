# Helper locations

Infrastructure build configuration shared by Linux adapters and the legacy APT
runner. Path receives only fixed names from source; never pass browser input.
Source builds retain /usr/local/libexec. Debian package builds set Directory to
/usr/libexec/coreops using ldflags. Existing root ownership/permissions checks
and sudoers remain authoritative; this package grants no privileges and does not
read environment configuration. See [operations](../../../../docs/modules/operations.md).
