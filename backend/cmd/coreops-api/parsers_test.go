package main

import "testing"

func TestParseAptUpgradableLine(t *testing.T) {
	update, ok := parseAptUpgradableLine("openssl/jammy-security 3.0.2-0ubuntu1.19 amd64 [upgradable from: 3.0.2-0ubuntu1.18]")
	if !ok {
		t.Fatal("expected a valid line")
	}
	if update.Package != "openssl" || update.Current != "3.0.2-0ubuntu1.18" || update.Available != "3.0.2-0ubuntu1.19" {
		t.Errorf("unexpected update: %+v", update)
	}
	if update.Type != "security" {
		t.Errorf("security pocket not detected: %+v", update)
	}
	for _, line := range []string{"", "Listing... Done", "WARNING: apt does not have a stable CLI interface.", "bad;name/jammy 1 amd64 [upgradable from: 0]"} {
		if _, ok := parseAptUpgradableLine(line); ok {
			t.Errorf("line %q should be ignored", line)
		}
	}
}

func TestParseUFWRules(t *testing.T) {
	status := `Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
8082/tcp                   ALLOW       100.64.0.0/10
`
	rules := parseUFWRules(status)
	if len(rules) != 2 {
		t.Fatalf("got %d rules: %+v", len(rules), rules)
	}
	if rules[0].To != "22/tcp" || rules[0].Action != "ALLOW" || rules[0].From != "Anywhere" {
		t.Errorf("unexpected first rule: %+v", rules[0])
	}
	if active, _ := detectUFWActive(status); !active {
		t.Error("active UFW not detected")
	}
}

func TestClassifySecurityEvent(t *testing.T) {
	cases := map[string]string{
		"Failed password for root from 1.2.3.4": "error",
		"Accepted publickey for pepe":           "success",
		"warning: something odd":                "warn",
		"session opened":                        "info",
	}
	for message, want := range cases {
		if got := classifySecurityEvent(message); got != want {
			t.Errorf("%q: got %s, want %s", message, got, want)
		}
	}
}

func TestInputValidators(t *testing.T) {
	good := map[string][]string{
		"container": {"abcdef123456", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"},
		"service":   {"ssh.service", "docker.service", "getty@tty1.service"},
		"package":   {"openssl", "libc6:amd64", "g++"},
	}
	bad := map[string][]string{
		"container": {"", "abc", "../etc", "abcdef123456; rm -rf /", "zzzzzzzzzzzz"},
		"service":   {"ssh", "ssh.service; reboot", "$(id).service", "../x.service"},
		"package":   {"", "-oAPT::x=1", "a b", "a;b"},
	}
	for _, v := range good["container"] {
		if !containerIDPattern.MatchString(v) {
			t.Errorf("container %q rejected", v)
		}
	}
	for _, v := range bad["container"] {
		if containerIDPattern.MatchString(v) {
			t.Errorf("container %q accepted", v)
		}
	}
	for _, v := range good["service"] {
		if !systemdUnitPattern.MatchString(v) {
			t.Errorf("service %q rejected", v)
		}
	}
	for _, v := range bad["service"] {
		if systemdUnitPattern.MatchString(v) {
			t.Errorf("service %q accepted", v)
		}
	}
	for _, v := range good["package"] {
		if !aptPackageNamePattern.MatchString(v) {
			t.Errorf("package %q rejected", v)
		}
	}
	for _, v := range bad["package"] {
		if aptPackageNamePattern.MatchString(v) {
			t.Errorf("package %q accepted", v)
		}
	}
}
