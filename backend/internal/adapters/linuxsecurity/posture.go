package linuxsecurity

import (
	"context"
	"encoding/json"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"os"
	"strings"
	"sync"
	"time"
)

func (s *Source) Posture(ctx context.Context) (core.Posture, error) {
	p := core.Posture{APT: core.APTHealth{Origins: []string{}, Exclusions: []string{}}, Jails: []core.Jail{}, Chains: []core.FirewallChain{}, Sensors: []core.Sensor{}, Sources: map[string]core.SourceStatus{}}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, op := range []string{"apt-health", "fail2ban-details", "nft", "sensors"} {
		wg.Add(1)
		go func(op string) {
			defer wg.Done()
			var err error
			switch op {
			case "apt-health":
				apt, e := s.aptHealth(ctx)
				err = e
				mu.Lock()
				p.APT = apt
				mu.Unlock()
			case "sensors":
				sensors, e := readSensors(ctx)
				err = e
				mu.Lock()
				p.Sensors = sensors
				mu.Unlock()
			case "fail2ban-details":
				// The old helper's generic status remains supported by overview. Detailed
				// evidence needs the separately installed read-only helper operation.
				data, e := s.evidence(ctx, op)
				err = e
				if err == nil {
					var out struct {
						Jails     []core.Jail `json:"jails"`
						Truncated bool        `json:"truncated"`
					}
					if json.Unmarshal([]byte(data), &out) != nil || out.Jails == nil {
						err = core.ErrUnavailable
					} else {
						mu.Lock()
						p.Jails = out.Jails
						p.JailsTruncated = out.Truncated
						mu.Unlock()
					}
				}
			case "nft":
				data, e := run(ctx, "/usr/sbin/nft", "--json", "list", "ruleset")
				if e != nil && core.Status(e).State == "permission_denied" {
					data, e = s.evidence(ctx, op)
				}
				err = e
				if err == nil {
					chains, e := firewallChains(data)
					err = e
					mu.Lock()
					p.Chains = chains
					mu.Unlock()
				}
			}
			mu.Lock()
			p.Sources[op] = core.Status(err)
			mu.Unlock()
		}(op)
	}
	wg.Wait()
	if ctx.Err() != nil {
		return p, ctx.Err()
	}
	return p, nil
}
func (s *Source) evidence(ctx context.Context, op string) (string, error) {
	if op != "fail2ban-details" && op != "nft" {
		return "", core.ErrInvalid
	}
	if !trustedHelper() {
		return "", &core.SourceError{State: "permission_denied", Detail: "Install the updated restricted Security helper for detailed read-only evidence"}
	}
	return run(ctx, "/usr/bin/sudo", "-n", "--", helper, op)
}
func (s *Source) aptHealth(ctx context.Context) (core.APTHealth, error) {
	a := core.APTHealth{Origins: []string{}, Exclusions: []string{}}
	config, err := s.Probe(ctx, "apt-policy")
	if err != nil {
		return a, err
	}
	a.Origins = append(core.APTList(config, "Unattended-Upgrade::Allowed-Origins"), core.APTList(config, "Unattended-Upgrade::Origins-Pattern")...)
	a.Exclusions = core.APTList(config, "Unattended-Upgrade::Package-Blacklist")
	installed, ie := run(ctx, "/usr/bin/dpkg-query", "-W", "-f=${db:Status-Status}", "unattended-upgrades")
	if ie == nil {
		v := strings.TrimSpace(installed) == "installed"
		a.Installed = &v
	} else {
		return a, ie
	}
	text, e := run(ctx, "/usr/bin/systemctl", "show", "apt-daily-upgrade.service", "--property=LoadState,Result,ExecMainStatus,ExecMainStartTimestamp")
	if e != nil {
		return a, e
	}
	props := core.Properties(text)
	if props["LoadState"] != "loaded" {
		return a, &core.SourceError{State: "unavailable", Detail: "The unattended-upgrade service is not installed"}
	}
	a.LastRun = props["ExecMainStartTimestamp"]
	if a.LastRun != "" {
		a.LastResult = props["Result"] + "; exit=" + props["ExecMainStatus"]
	}
	_, e = os.Stat("/run/reboot-required")
	if e == nil || os.IsNotExist(e) {
		v := e == nil
		a.RebootRequired = &v
	} else {
		return a, e
	}
	return a, nil
}
func readSensors(ctx context.Context) ([]core.Sensor, error) {
	definitions := []core.Sensor{{ID: "auditd", Label: "Linux Audit", Kind: "audit"}, {ID: "clamav-daemon", Label: "ClamAV", Kind: "malware"}, {ID: "falco", Label: "Falco", Kind: "runtime detection"}, {ID: "suricata", Label: "Suricata", Kind: "network IDS"}, {ID: "wazuh-agent", Label: "Wazuh agent", Kind: "endpoint detection"}, {ID: "osqueryd", Label: "osquery", Kind: "endpoint inventory"}, {ID: "coreops-aide", Label: "AIDE scheduled check", Kind: "file integrity"}, {ID: "coreops-malware", Label: "Scheduled malware scan", Kind: "malware"}}
	args := []string{"show"}
	for _, sensor := range definitions {
		args = append(args, sensor.ID+".service")
	}
	args = append(args, "coreops-aide.timer", "coreops-malware.timer", "--property=Id,LoadState,ActiveState,UnitFileState,ExecMainStartTimestamp,Result")
	out, e := run(ctx, "/usr/bin/systemctl", args...)
	if e != nil {
		return definitions, e
	}
	blocks := map[string]map[string]string{}
	for _, block := range strings.Split(strings.TrimSpace(out), "\n\n") {
		p := core.Properties(block)
		blocks[p["Id"]] = p
	}
	for i := range definitions {
		v := &definitions[i]
		p := blocks[v.ID+".service"]
		if p["LoadState"] == "" {
			v.Detail = "Service state not reported"
			continue
		}
		installed := p["LoadState"] == "loaded"
		active := p["ActiveState"] == "active"
		v.Installed = &installed
		v.Active = &active
		v.LastRun = p["ExecMainStartTimestamp"]
		if v.LastRun != "" {
			v.LastResult = p["Result"]
		}
		if strings.HasPrefix(v.ID, "coreops-") {
			timer := blocks[v.ID+".timer"]
			if timer["LoadState"] != "" {
				scheduled := timer["LoadState"] == "loaded" && timer["ActiveState"] == "active" && timer["UnitFileState"] == "enabled"
				v.Scheduled = &scheduled
			}
		}
		if v.ID == "clamav-daemon" {
			for _, name := range []string{"/var/lib/clamav/daily.cld", "/var/lib/clamav/daily.cvd"} {
				if st, err := os.Stat(name); err == nil && st.Mode().IsRegular() {
					v.SignatureUpdatedAt = st.ModTime().UTC().Format(time.RFC3339Nano)
					break
				}
			}
		}
		v.Detail = "Service " + p["LoadState"] + ", " + p["ActiveState"] + ". Running is not proof of correct rules, signatures or coverage."
	}
	return definitions, nil
}
func firewallChains(data string) ([]core.FirewallChain, error) {
	var doc struct {
		NFT []struct {
			Chain *struct{ Family, Table, Name, Hook, Policy string }
			Rule  *struct{ Family, Table, Chain string }
		} `json:"nftables"`
	}
	if json.Unmarshal([]byte(data), &doc) != nil || doc.NFT == nil {
		return nil, core.ErrUnavailable
	}
	chains := []core.FirewallChain{}
	counts := map[string]int{}
	for _, row := range doc.NFT {
		if r := row.Rule; r != nil {
			counts[r.Family+"/"+r.Table+"/"+r.Chain]++
		}
	}
	for _, row := range doc.NFT {
		if c := row.Chain; c != nil {
			chains = append(chains, core.FirewallChain{Family: c.Family, Table: c.Table, Name: c.Name, Hook: c.Hook, Policy: c.Policy, Rules: counts[c.Family+"/"+c.Table+"/"+c.Name]})
		}
	}
	if len(chains) > 512 {
		return chains[:512], &core.SourceError{State: "partial", Detail: "More than 512 chains; refine the host firewall inventory"}
	}
	return chains, nil
}
func (s *Source) SSHPolicy(ctx context.Context, c core.SSHContext) (core.SSHPolicy, error) {
	result := core.SSHPolicy{Context: c, Checks: []core.Check{}}
	if !core.ValidSSHContext(c) {
		return result, core.ErrInvalid
	}
	host := c.Host
	if host == "" {
		host = c.Address
	}
	out, err := run(ctx, "/usr/sbin/sshd", "-T", "-C", "user="+c.User+",addr="+c.Address+",host="+host)
	if err != nil && core.Status(err).State == "permission_denied" && trustedHelper() {
		input, _ := json.Marshal(c)
		out, err = runInput(ctx, input, "/usr/bin/sudo", "-n", "--", helper, "sshd-context")
	}
	result.Source = core.Status(err)
	if err != nil {
		return result, nil
	}
	key, root := core.SSHChecks(out, nil)
	key.Detail = "Evaluated for the supplied user/address/host: " + strings.ReplaceAll(key.Detail, "Global policy:", "policy:")
	root.Detail = "Evaluated PermitRootLogin " + core.Value(out, "permitrootlogin") + " for the supplied context. Authentication can still be restricted by AllowUsers, DenyUsers, groups and account state."
	result.Checks = []core.Check{key, root}
	// These are policy restrictions, never credentials. Do not expose raw sshd -T.
	result.AuthenticationMethods = core.Value(out, "authenticationmethods")
	result.AllowUsers = policyLine(out, "allowusers")
	result.DenyUsers = policyLine(out, "denyusers")
	return result, nil
}
func policyLine(text, key string) string {
	for _, line := range strings.Split(text, "\n") {
		f := strings.Fields(line)
		if len(f) > 1 && f[0] == key {
			v := strings.Join(f[1:], " ")
			if len(v) > 512 {
				v = v[:512]
			}
			return v
		}
	}
	return ""
}
