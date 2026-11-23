package security

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

func Value(config, key string) string {
	for _, line := range strings.Split(config, "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 && strings.EqualFold(f[0], key) {
			return strings.Trim(strings.TrimSuffix(f[1], ";"), `"`)
		}
	}
	return ""
}
func Properties(text string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		if k, v, ok := strings.Cut(line, "="); ok {
			out[k] = v
		}
	}
	return out
}
func MakeCheck(id, label, detail string, ok *bool) Check {
	status := "unknown"
	if ok != nil {
		status = "attention"
		if *ok {
			status = "pass"
		}
	}
	return Check{ID: id, Label: label, Detail: detail, OK: ok, Status: status}
}
func Bool(v bool) *bool { return &v }
func SSHChecks(text string, err error) (Check, Check) {
	key := MakeCheck("ssh-key-auth", "SSH key auth only", "Global OpenSSH configuration is unavailable", nil)
	root := MakeCheck("root-login", "Root login disabled", "Global OpenSSH configuration is unavailable", nil)
	if err != nil {
		key.Detail = err.Error()
		root.Detail = err.Error()
		return key, root
	}
	password, interactive, publickey := Value(text, "passwordauthentication"), Value(text, "kbdinteractiveauthentication"), Value(text, "pubkeyauthentication")
	gss, hostbased := Value(text, "gssapiauthentication"), Value(text, "hostbasedauthentication")
	if password != "" && interactive != "" && publickey != "" && gss != "" && hostbased != "" {
		key.OK = Bool(password == "no" && interactive == "no" && publickey == "yes" && gss == "no" && hostbased == "no")
		key = MakeCheck(key.ID, key.Label, fmt.Sprintf("Global policy: password=%s, keyboard-interactive=%s, publickey=%s, GSSAPI=%s, hostbased=%s. Match rules may differ by user/source; MFA can intentionally enable interactive authentication.", password, interactive, publickey, gss, hostbased), key.OK)
	}
	policy := Value(text, "permitrootlogin")
	if policy != "" {
		root = MakeCheck(root.ID, root.Label, "Global PermitRootLogin "+policy+"; Match rules can override this policy", Bool(policy == "no"))
		if policy == "prohibit-password" || policy == "without-password" {
			root.Detail = "Root password login disabled, but root public-key login remains allowed (global policy)"
		}
	}
	return key, root
}
func AutoUpdates(config, timer string, configErr, timerErr error) Check {
	c := MakeCheck("auto-updates", "Auto security updates", "Effective APT policy and apt-daily-upgrade.timer must both be readable", nil)
	if configErr != nil {
		c.Detail = configErr.Error()
		return c
	}
	if timerErr != nil {
		c.Detail = timerErr.Error()
		return c
	}
	props := Properties(timer)
	if props["LoadState"] != "loaded" {
		c.Detail = "apt-daily-upgrade.timer is not installed or could not be loaded"
		return c
	}
	apt, known := APTPolicy(config)
	if !known {
		c.Detail = "Unrecognized APT::Periodic::Enable value; check effective APT policy"
		return c
	}
	if Value(config, "CoreOps::OS::ID") == "" || Value(config, "CoreOps::OS::Codename") == "" {
		c.Detail = "Distribution identity is unavailable; security origins cannot be verified"
		return c
	}
	if exclusions := APTList(config, "Unattended-Upgrade::Package-Blacklist"); len(exclusions) > 0 {
		c.Detail = fmt.Sprintf("%d package exclusion patterns require review; full security update coverage is not verified", len(exclusions))
		return c
	}
	enabled := props["UnitFileState"] == "enabled" // enabled-runtime does not persist across boots.

	return MakeCheck(c.ID, c.Label, fmt.Sprintf("Effective APT periodic policy enabled=%t; upgrade timer active=%s, persistent=%s. Security origins must also be configured. A running unattended-upgrades service alone does not schedule upgrades.", apt, props["ActiveState"], props["UnitFileState"]), Bool(apt && SecurityOrigins(config) && enabled && props["ActiveState"] == "active"))
}

// APTPolicy checks effective periodic configuration; it does not infer timer state.
func APTPolicy(config string) (bool, bool) {
	enable := strings.ToLower(Value(config, "APT::Periodic::Enable"))
	switch enable {
	case "", "1", "true", "yes", "on", "0", "false", "no", "off":
	default:
		return false, false
	}
	global := enable == "" || enable == "1" || enable == "true" || enable == "yes" || enable == "on"
	positive := func(value string) bool {
		if value == "always" {
			return true
		}
		n, e := strconv.Atoi(value)
		return e == nil && n > 0
	}
	return global && positive(Value(config, "APT::Periodic::Update-Package-Lists")) && positive(Value(config, "APT::Periodic::Unattended-Upgrade")), true
}

var ufwLine = regexp.MustCompile(`^\s*(?:\[\s*(\d+)\]\s*)?(.+?)\s+(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT|FWD))?\s+(.+?)(?:\s+#\s*(.*))?$`)

func ParseRules(text string) []Rule {
	result := []Rule{}
	for _, line := range strings.Split(text, "\n") {
		m := ufwLine.FindStringSubmatch(line)
		if len(m) == 0 {
			continue
		}
		action := m[3]
		if m[4] != "" {
			action += " " + m[4]
		}
		result = append(result, Rule{Number: m[1], To: strings.TrimSpace(m[2]), Action: action, From: strings.TrimSpace(m[5]), Comment: m[6]})
	}
	return result
}
func Firewall(text string) (*bool, bool) {
	for _, line := range strings.Split(text, "\n") {
		k, v, ok := strings.Cut(strings.ToLower(strings.TrimSpace(line)), ":")
		if ok && k == "status" {
			if strings.TrimSpace(v) == "active" {
				return Bool(true), true
			}
			if strings.TrimSpace(v) == "inactive" {
				return Bool(false), true
			}
		}
	}
	return nil, false
}

var banWord = regexp.MustCompile(`\bban\b`)

func Classify(message string) string {
	m := strings.ToLower(message)
	switch {
	case strings.Contains(m, "unban"):
		return "success"
	case strings.Contains(m, "failed"), strings.Contains(m, "banned"), strings.Contains(m, "denied"), strings.Contains(m, "blocked"), strings.Contains(m, "invalid user"), banWord.MatchString(m):
		return "error"
	case strings.Contains(m, "accepted"), strings.Contains(m, "allow"), strings.Contains(m, "started"), strings.Contains(m, "renewed"):
		return "success"
	case strings.Contains(m, "warning"), strings.Contains(m, "warn"):
		return "warn"
	default:
		return "info"
	}
}
