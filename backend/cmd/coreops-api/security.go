package main

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type SecurityCheck struct {
	Label  string `json:"label"`
	OK     *bool  `json:"ok"`
	Detail string `json:"detail"`
}
type SecuritySession struct {
	User   string `json:"user"`
	From   string `json:"from"`
	Since  string `json:"since"`
	Method string `json:"method"`
	PID    int    `json:"pid"`
}
type FirewallRule struct {
	Number  string `json:"number"`
	To      string `json:"to"`
	Action  string `json:"action"`
	From    string `json:"from"`
	Comment string `json:"comment,omitempty"`
}
type SecurityEvent struct {
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	Message   string `json:"message"`
}
type SecurityOverview struct {
	UpdatedAt       string            `json:"updatedAt"`
	Checks          []SecurityCheck   `json:"checks"`
	Sessions        []SecuritySession `json:"sessions"`
	FirewallActive  bool              `json:"firewallActive"`
	FirewallRules   []FirewallRule    `json:"firewallRules"`
	FirewallVersion string            `json:"firewallVersion"`
	Events          []SecurityEvent   `json:"events"`
}

var ufwActivePattern = regexp.MustCompile(`(?im)^\s*status\s*:\s*active\s*$`)

func collectSecurity(ctx context.Context) (SecurityOverview, error) {
	overview := SecurityOverview{UpdatedAt: time.Now().UTC().Format(time.RFC3339), FirewallRules: []FirewallRule{}, Sessions: []SecuritySession{}, Events: []SecurityEvent{}}
	ufwStatus, _ := runSecurityCommand(ctx, "ufw", "status", "verbose")
	firewallActive, firewallDetail := detectUFWActive(ufwStatus)
	overview.FirewallActive = firewallActive
	overview.FirewallRules = parseUFWRules(ufwStatus)
	if version, err := runSecurityCommand(ctx, "ufw", "version"); err == nil {
		overview.FirewallVersion = firstLine(version)
	}
	sshConfig, _ := runSecurityCommand(ctx, "sshd", "-T")
	passwordAuth := configValue(sshConfig, "passwordauthentication")
	rootLogin := configValue(sshConfig, "permitrootlogin")
	keyOnly := strings.EqualFold(passwordAuth, "no")
	rootDisabled := strings.EqualFold(rootLogin, "no") || strings.EqualFold(rootLogin, "prohibit-password")
	fail2banStatus, fail2banErr := runSecurityCommand(ctx, "fail2ban-client", "status")
	fail2banOK := fail2banErr == nil && strings.Contains(strings.ToLower(fail2banStatus), "number of jail")
	fail2banDetail := "Inactive or unavailable"
	if fail2banOK {
		fail2banDetail = "Active"
		if jailLine := findLine(fail2banStatus, "Jail list"); jailLine != "" {
			parts := strings.SplitN(jailLine, ":", 2)
			if len(parts) == 2 {
				jails := strings.TrimSpace(parts[1])
				if jails != "" {
					fail2banDetail = fmt.Sprintf("Active · %d jails", strings.Count(jails, ",")+1)
				}
			}
		}
	}
	updatesActive, updatesDetail := unattendedUpdatesStatus(ctx)
	openPorts := countListeningPorts(ctx)
	overview.Checks = []SecurityCheck{
		{Label: "Firewall (ufw)", OK: boolPtr(firewallActive), Detail: firewallDetail},
		{Label: "SSH key auth only", OK: boolPtr(keyOnly), Detail: sshAuthDetail(passwordAuth)},
		{Label: "Root login disabled", OK: boolPtr(rootDisabled), Detail: rootLoginDetail(rootLogin)},
		{Label: "fail2ban", OK: boolPtr(fail2banOK), Detail: fail2banDetail},
		{Label: "Auto security updates", OK: boolPtr(updatesActive), Detail: updatesDetail},
		{Label: "Open ports", OK: nil, Detail: fmt.Sprintf("%d listening ports detected", openPorts)},
	}
	overview.Sessions = collectSecuritySessions(ctx)
	overview.Events = collectSecurityEvents(ctx)
	return overview, nil
}

func detectUFWActive(status string) (bool, string) {
	if ufwActivePattern.MatchString(status) {
		return true, fmt.Sprintf("Active · %d rules", len(parseUFWRules(status)))
	}
	// `ufw status` can fail when the API user cannot elevate with sudo -n. The
	// persistent UFW config is still readable and records whether UFW is enabled.
	if conf, err := os.ReadFile("/etc/ufw/ufw.conf"); err == nil {
		for _, line := range strings.Split(string(conf), "\n") {
			parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
			if len(parts) == 2 && strings.EqualFold(strings.TrimSpace(parts[0]), "ENABLED") && strings.EqualFold(strings.TrimSpace(parts[1]), "yes") {
				return true, "Enabled · UFW configuration reports ENABLED=yes"
			}
		}
	}
	return false, "Inactive"
}

func (a *API) security(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	overview, err := collectSecurity(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}
func (a *API) terminateSecuritySession(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil || pid <= 1 || pid > 4194304 {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid session PID"})
		return
	}
	if err := syscallKill(pid); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pid": pid})
}
func (a *API) fixSecurity(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("item") != "auto-updates" {
		writeJSON(w, http.StatusNotFound, ErrorResponse{Error: "unknown security fix"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if _, err := runSecurityCommand(ctx, "systemctl", "enable", "--now", "unattended-upgrades.service"); err != nil {
		if _, err2 := runSecurityCommand(ctx, "systemctl", "enable", "--now", "unattended-upgrades"); err2 != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "item": "auto-updates"})
}
func runSecurityCommand(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	if err == nil {
		return string(out), nil
	}
	if os.Geteuid() != 0 {
		sudo := exec.CommandContext(ctx, "sudo", append([]string{"-n", name}, args...)...)
		if sudoOut, sudoErr := sudo.CombinedOutput(); sudoErr == nil {
			return string(sudoOut), nil
		}
	}
	return string(out), err
}
func parseUFWRules(status string) []FirewallRule {
	result := make([]FirewallRule, 0)
	inRules := false
	for _, raw := range strings.Split(status, "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "To ") && strings.Contains(line, "Action") && strings.Contains(line, "From") {
			inRules = true
			continue
		}
		if !inRules || line == "" || strings.HasPrefix(line, "--") || strings.HasPrefix(line, "Status:") || strings.HasPrefix(line, "Logging:") || strings.HasPrefix(line, "Default:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		toIdx := 0
		if _, err := strconv.Atoi(strings.TrimSuffix(fields[0], ")")); err == nil {
			toIdx = 1
		}
		if len(fields) < toIdx+3 {
			continue
		}
		rule := FirewallRule{To: fields[toIdx], Action: strings.ToUpper(fields[toIdx+1]), From: strings.Join(fields[toIdx+2:], " ")}
		if toIdx == 1 {
			rule.Number = strings.TrimSuffix(strings.TrimSuffix(fields[0], ")"), "(")
		}
		result = append(result, rule)
	}
	return result
}
func collectSecuritySessions(ctx context.Context) []SecuritySession {
	out, err := runSecurityCommand(ctx, "who", "-u")
	if err != nil {
		return []SecuritySession{}
	}
	result := make([]SecuritySession, 0)
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		pid := 0
		for _, f := range fields {
			if n, e := strconv.Atoi(strings.Trim(f, "()")); e == nil && n > 1 {
				pid = n
				break
			}
		}
		if pid == 0 {
			continue
		}
		from := "local"
		if i := strings.LastIndex(line, "("); i >= 0 {
			from = strings.TrimSuffix(strings.TrimSpace(line[i+1:]), ")")
		}
		since := fields[3]
		if len(fields) > 4 {
			since += " " + fields[4]
		}
		result = append(result, SecuritySession{User: fields[0], From: from, Since: since, Method: "session", PID: pid})
	}
	return result
}
func collectSecurityEvents(ctx context.Context) []SecurityEvent {
	out, err := runSecurityCommand(ctx, "journalctl", "--no-pager", "-o", "short-iso", "--since", "24 hours ago", "-u", "ssh", "-u", "sshd", "-u", "ufw", "-u", "fail2ban", "-n", "120")
	if err != nil {
		return []SecurityEvent{}
	}
	result := make([]SecurityEvent, 0)
	for _, raw := range strings.Split(out, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.Contains(line, "-- No entries --") {
			continue
		}
		parts := strings.SplitN(line, " ", 2)
		if len(parts) != 2 {
			continue
		}
		result = append(result, SecurityEvent{Timestamp: parts[0], Type: classifySecurityEvent(parts[1]), Message: parts[1]})
	}
	return result
}
func classifySecurityEvent(message string) string {
	m := strings.ToLower(message)
	switch {
	case strings.Contains(m, "failed"), strings.Contains(m, "banned"), strings.Contains(m, "denied"), strings.Contains(m, "blocked"), strings.Contains(m, "invalid user"):
		return "error"
	case strings.Contains(m, "accepted"), strings.Contains(m, "allow"), strings.Contains(m, "started"), strings.Contains(m, "renewed"):
		return "success"
	case strings.Contains(m, "warning"), strings.Contains(m, "warn"):
		return "warn"
	default:
		return "info"
	}
}
func unattendedUpdatesStatus(ctx context.Context) (bool, string) {
	active, activeErr := runSecurityCommand(ctx, "systemctl", "is-active", "unattended-upgrades.service")
	enabled, enabledErr := runSecurityCommand(ctx, "systemctl", "is-enabled", "unattended-upgrades.service")
	if activeErr == nil && strings.TrimSpace(active) == "active" {
		return true, "Active · automatic security updates enabled"
	}
	if enabledErr == nil && strings.TrimSpace(enabled) == "enabled" {
		return true, "Enabled · service not currently active"
	}
	return false, "unattended-upgrades service is not active"
}
func countListeningPorts(ctx context.Context) int {
	out, err := runSecurityCommand(ctx, "ss", "-lntup")
	if err != nil {
		return 0
	}
	count := 0
	for _, line := range strings.Split(out, "\n") {
		s := strings.TrimSpace(line)
		if s != "" && !strings.HasPrefix(s, "Netid") {
			count++
		}
	}
	return count
}
func configValue(config, key string) string {
	for _, line := range strings.Split(config, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && strings.EqualFold(fields[0], key) {
			return fields[1]
		}
	}
	return ""
}
func findLine(text, prefix string) string {
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), prefix) {
			return strings.TrimSpace(line)
		}
	}
	return ""
}
func firstLine(text string) string {
	for _, line := range strings.Split(text, "\n") {
		if value := strings.TrimSpace(line); value != "" {
			return value
		}
	}
	return ""
}
func boolPtr(v bool) *bool { return &v }
func firewallDetail(active bool, rules []FirewallRule) string {
	if !active {
		return "Inactive"
	}
	return fmt.Sprintf("Active · %d rules", len(rules))
}
func sshAuthDetail(value string) string {
	if value == "no" {
		return "Password login disabled"
	}
	if value == "" {
		return "Could not read sshd configuration"
	}
	return "Password login enabled"
}
func rootLoginDetail(value string) string {
	if value == "no" {
		return "PermitRootLogin no"
	}
	if value == "prohibit-password" {
		return "Root password login disabled"
	}
	if value == "" {
		return "Could not read sshd configuration"
	}
	return "Root login policy: " + value
}
func syscallKill(pid int) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return p.Signal(os.Kill)
}
