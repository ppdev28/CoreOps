# Linux Security evidence

Fixed argv/minimal environment/deadlines/output limits for UFW, OpenSSH, fail2ban,
APT, nftables, systemd and journal. Errors are typed evidence states, not invented
inactive/empty results. Posture owns distro/origin, timer/run/reboot and sensor
metadata. Contextual SSH policy accepts validated user/IP/host only and exports
checks/restrictions, not raw sshd output.

The optional root-owned helper supplies restricted read-only evidence; timer
activation remains separate. No generic sudo, firewall edits, sensor installs,
SSH configuration writes or session signals through that helper. Its nested
Python evidence collector has independent validation and bounded subprocess IO.

Journal pages cover fixed security categories with forward/reverse cursors.
Forward lines=+N prevents jumping past a burst. A private atomic/fsynced checkpoint
supports the core monitor, which runs only in the main API process, not route/test
composition. Invalid cursor/access/storage never silently advances the cursor.

OpenSSH uses trusted executables, boot/PID/start identity, ancestry protection,
OS signal permission and pidfd SIGTERM. Tailscale terminal evidence remains view
only; don't infer arbitrary SSH or forwarding connections from an IP address.
The opt-in loopback test owns its server and connection; never test against the
user's existing shell. [Guide](../../../../docs/modules/host-security.md).
