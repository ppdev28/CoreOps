package linuxsecurity

import (
	"context"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"strconv"
)

var securityJournalMatches = map[string][]string{
	"ssh":       {"_SYSTEMD_UNIT=ssh.service", "_SYSTEMD_UNIT=sshd.service", "_SYSTEMD_UNIT=ssh.socket", "SYSLOG_IDENTIFIER=sshd", "SYSLOG_IDENTIFIER=sshd-session"},
	"tailscale": {"_SYSTEMD_UNIT=tailscaled.service"},
	"kernel":    {"_TRANSPORT=kernel"},
	"audit":     {"_TRANSPORT=audit", "_SYSTEMD_UNIT=auditd.service"},
	"auth":      {"SYSLOG_FACILITY=4", "SYSLOG_FACILITY=10", "SYSLOG_IDENTIFIER=sudo", "SYSLOG_IDENTIFIER=su", "SYSLOG_IDENTIFIER=login"},
	"sensors":   {"_SYSTEMD_UNIT=fail2ban.service", "_SYSTEMD_UNIT=falco.service", "_SYSTEMD_UNIT=suricata.service", "_SYSTEMD_UNIT=wazuh-agent.service", "_SYSTEMD_UNIT=clamav-daemon.service", "_SYSTEMD_UNIT=aidecheck.service", "_SYSTEMD_UNIT=coreops-aide.service", "_SYSTEMD_UNIT=coreops-malware.service", "SYSLOG_IDENTIFIER=suricata", "SYSLOG_IDENTIFIER=clamd", "SYSLOG_IDENTIFIER=coreops-aide", "SYSLOG_IDENTIFIER=coreops-malware"},
}

func journalArgs(q core.EventQuery) []string {
	args := []string{"--no-pager", "--output=json", "--output-fields=__CURSOR,__REALTIME_TIMESTAMP,MESSAGE,_SYSTEMD_UNIT,SYSLOG_IDENTIFIER,_TRANSPORT"}
	if q.Direction == "newer" {
		args = append(args, "--after-cursor="+q.Cursor, "--lines=+"+strconv.Itoa(q.Limit+1))
	} else {
		args = append(args, "--reverse", "--lines="+strconv.Itoa(q.Limit+2))
		if q.Cursor != "" {
			args = append(args, "--cursor="+q.Cursor)
		}
	}
	matches := []string{}
	if q.Category == "all" {
		for _, key := range []string{"ssh", "tailscale", "kernel", "audit", "auth", "sensors"} {
			matches = append(matches, securityJournalMatches[key]...)
		}
	} else {
		matches = securityJournalMatches[q.Category]
	}
	for i, match := range matches {
		if i > 0 {
			args = append(args, "+")
		}
		args = append(args, match)
	}
	return args
}
func (s *Source) Events(ctx context.Context, q core.EventQuery) (core.EventPage, error) {
	if !core.ValidEventQuery(q) {
		return core.EventPage{}, core.ErrInvalid
	}
	text, err := run(ctx, "/usr/bin/journalctl", journalArgs(q)...)
	if err != nil {
		return core.EventPage{Events: []core.Event{}, Signals: []core.Signal{}, Source: core.Status(err)}, nil
	}
	return core.DecodeEvents(text, q), nil
}
