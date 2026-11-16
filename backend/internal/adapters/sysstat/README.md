# Sysstat history adapter

Read-only adapter for existing Linux sar archives. Embedded archive timestamps and `sadf`'s aggregate CPU/memory values feed CoreOps-owned points. Directories/files, output, duration, concurrency and cache are bounded; inherited descriptors bind reads to checked regular files. No shell, arbitrary client paths, collector installation or privilege elevation.

See [configuration, metric definitions and limits](../../../../docs/modules/monitoring-history.md). Tests use a controlled executable and fixtures; real archive reads require explicit `COREOPS_TEST_SYSSTAT=1`.
