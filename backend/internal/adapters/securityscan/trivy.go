// Package securityscan invokes an explicitly configured local scanner. It never
// accepts paths, registries, shell commands, plugin flags or credentials from HTTP.
package securityscan

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/moby/moby/client"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
)

type Trivy struct {
	Binary, Cache string
	Docker        *client.Client
}

var digest = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

func (t *Trivy) trusted() bool {
	if !filepath.IsAbs(t.Binary) {
		return false
	}
	st, err := os.Lstat(t.Binary)
	if err != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0022 != 0 || st.Mode().Perm()&0100 == 0 {
		return false
	}
	owner, ok := st.Sys().(*syscall.Stat_t)
	if !ok || (owner.Uid != 0 && owner.Uid != uint32(os.Geteuid())) {
		return false
	}
	for parent := filepath.Dir(t.Binary); ; parent = filepath.Dir(parent) {
		info, err := os.Lstat(parent)
		if err != nil || !info.IsDir() || info.Mode().Perm()&0022 != 0 {
			return false
		}
		owner, ok := info.Sys().(*syscall.Stat_t)
		if !ok || (owner.Uid != 0 && owner.Uid != uint32(os.Geteuid())) {
			return false
		}
		if parent == "/" {
			break
		}
	}
	return true
}
func (t *Trivy) Capabilities(ctx context.Context) (core.ScanCapability, error) {
	host, _ := os.Hostname()
	boot, _ := os.ReadFile("/proc/sys/kernel/random/boot_id")
	caps := core.ScanCapability{Hostname: host, BootID: strings.TrimSpace(string(boot)), Targets: []core.ScanTarget{{ID: "host", Label: "Host OS packages", Kind: "host"}}}
	if !t.trusted() {
		caps.Reason = "Install a trusted Trivy binary and configure COREOPS_TRIVY_PATH; no CVE coverage is claimed until a scan completes"
		return caps, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, t.Binary, "--version")
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C"}
	var b cappedBuffer
	b.limit = 8192
	cmd.Stdout = &b
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		caps.Reason = "Configured scanner did not report its version"
		return caps, nil
	}
	caps.Version = strings.TrimSpace(b.String())
	caps.Available = host != "" && caps.BootID != ""
	if t.Docker != nil {
		images, err := t.Docker.ImageList(ctx, client.ImageListOptions{})
		if err == nil {
			for _, image := range images.Items {
				if len(caps.Targets) >= 101 {
					break
				}
				if !digest.MatchString(image.ID) {
					continue
				}
				label := image.ID
				if len(image.RepoTags) > 0 {
					label = image.RepoTags[0]
				}
				caps.Targets = append(caps.Targets, core.ScanTarget{ID: image.ID, Label: label, Kind: "image"})
			}
		}
	}
	return caps, nil
}

type cappedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.limit {
		return 0, errors.New("scanner output limit")
	}
	return b.Buffer.Write(p)
}
func (t *Trivy) Scan(ctx context.Context, target string) (core.ScanReport, error) {
	if !t.trusted() {
		return core.ScanReport{}, core.ErrUnavailable
	}
	work, err := os.MkdirTemp("", "coreops-scan-")
	if err != nil {
		return core.ScanReport{}, err
	}
	defer os.RemoveAll(work)
	if err = os.MkdirAll(t.Cache, 0700); err != nil {
		return core.ScanReport{}, err
	}
	args := []string{}
	coverage := "Installed OS packages from a private copy of the host dpkg inventory; excludes application source, secrets and live memory"
	if target == "host" {
		for _, entry := range []struct{ source, target string }{{"/etc/os-release", "etc/os-release"}, {"/etc/lsb-release", "etc/lsb-release"}, {"/etc/debian_version", "etc/debian_version"}, {"/var/lib/dpkg/status", "var/lib/dpkg/status"}} {
			// /etc/os-release is commonly a distribution-owned symlink. Open the fixed
			// source then require a bounded regular file, never follow browser input.
			f, e := os.Open(entry.source)
			if os.IsNotExist(e) && (entry.source == "/etc/lsb-release" || entry.source == "/etc/debian_version") {
				continue
			}
			if e != nil {
				return core.ScanReport{}, e
			}
			st, e := f.Stat()
			if e != nil || !st.Mode().IsRegular() || st.Size() > 64<<20 {
				f.Close()
				return core.ScanReport{}, errors.New("unsupported package inventory")
			}
			data, e := io.ReadAll(io.LimitReader(f, 64<<20+1))
			f.Close()
			if e != nil || len(data) > 64<<20 {
				return core.ScanReport{}, errors.New("package inventory limit")
			}
			path := filepath.Join(work, entry.target)
			if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
				return core.ScanReport{}, e
			}
			if e = os.WriteFile(path, data, 0600); e != nil {
				return core.ScanReport{}, e
			}
		}
		args = []string{"rootfs", "--pkg-types", "os"}
	} else {
		if !digest.MatchString(target) || t.Docker == nil {
			return core.ScanReport{}, core.ErrInvalid
		}
		if _, err = t.Docker.ImageInspect(ctx, target); err != nil {
			return core.ScanReport{}, core.ErrNotFound
		}
		args = []string{"image", "--image-src", "docker"}
		coverage = "Supported OS and application packages in an immutable local Docker image; no remote image pulls, live process inspection or secret scanning"
	}
	args = append(args, "--scanners", "vuln", "--format", "json", "--list-all-pkgs", "--timeout", "5m", "--cache-dir", t.Cache, "--config", "/dev/null", "--skip-java-db-update", "--skip-check-update", "--quiet")
	if target == "host" {
		args = append(args, work)
	} else {
		args = append(args, target)
	}
	cmd := exec.CommandContext(ctx, t.Binary, args...)
	cmd.Dir = work
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C", "LC_ALL=C", "HOME=" + work, "DOCKER_HOST=unix:///var/run/docker.sock"}
	cmd.WaitDelay = 2 * time.Second
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	var output, stderr cappedBuffer
	output.limit = 16 << 20
	stderr.limit = 64 << 10
	cmd.Stdout = &output
	cmd.Stderr = &stderr
	if err = cmd.Run(); err != nil {
		return core.ScanReport{}, errors.New("Trivy scan did not complete; verify the local database and target")
	}
	report, err := decodeReport(output.Bytes())
	if err != nil {
		return report, err
	}
	report.Coverage = coverage
	// Database freshness is separate from the scan timestamp.
	if data, e := os.ReadFile(filepath.Join(t.Cache, "db", "metadata.json")); e == nil && len(data) < 8192 {
		var m struct{ UpdatedAt string }
		if json.Unmarshal(data, &m) == nil {
			report.DatabaseUpdatedAt = m.UpdatedAt
		}
	}
	return report, nil
}
func decodeReport(data []byte) (core.ScanReport, error) {
	report := core.ScanReport{Scanner: "Trivy", ScannedAt: time.Now().UTC().Format(time.RFC3339Nano), Vulnerabilities: []core.Vulnerability{}, Counts: map[string]int{}}
	var raw struct {
		SchemaVersion int
		Metadata      struct {
			OS *struct {
				Family, Name string
				EOSL         bool
			}
		}
		Results []struct {
			Target, Class, Type string
			Packages            []json.RawMessage
			Vulnerabilities     []struct{ VulnerabilityID, PkgName, InstalledVersion, FixedVersion, Severity, Title, PrimaryURL, Status string }
		}
	}
	if json.Unmarshal(data, &raw) != nil || raw.SchemaVersion == 0 || raw.Results == nil {
		return report, errors.New("unsupported scanner response")
	}
	if raw.Metadata.OS != nil {
		report.OS = raw.Metadata.OS.Family + " " + raw.Metadata.OS.Name
		report.EndOfLife = raw.Metadata.OS.EOSL
	}
	seen := map[string]bool{}
	advisoryIDs := map[string]bool{}
	for _, result := range raw.Results {
		report.Packages += len(result.Packages)
		for _, v := range result.Vulnerabilities {
			key := result.Target + ":" + v.VulnerabilityID + ":" + v.PkgName + ":" + v.InstalledVersion
			if seen[key] {
				continue
			}
			seen[key] = true
			severity := strings.ToUpper(v.Severity)
			switch severity {
			case "CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN":
			default:
				severity = "UNKNOWN"
			}
			report.Counts[severity]++
			advisoryIDs[v.VulnerabilityID] = true
			if v.FixedVersion != "" {
				report.FixAvailable++
			}
			link := ""
			if u, e := url.Parse(v.PrimaryURL); e == nil && u.Scheme == "https" && u.User == nil && u.Hostname() != "" {
				link = v.PrimaryURL
			}
			report.Vulnerabilities = append(report.Vulnerabilities, core.Vulnerability{Status: bound(v.Status), ID: bound(v.VulnerabilityID), Package: bound(v.PkgName), Installed: bound(v.InstalledVersion), Fixed: bound(v.FixedVersion), Severity: severity, Title: bound(v.Title), URL: link, Target: bound(result.Target)})
		}
	}
	report.UniqueAdvisories = len(advisoryIDs)
	rank := map[string]int{"CRITICAL": 5, "HIGH": 4, "MEDIUM": 3, "LOW": 2, "UNKNOWN": 1}
	sort.SliceStable(report.Vulnerabilities, func(i, j int) bool {
		a, b := report.Vulnerabilities[i], report.Vulnerabilities[j]
		if rank[a.Severity] != rank[b.Severity] {
			return rank[a.Severity] > rank[b.Severity]
		}
		if (a.Fixed != "") != (b.Fixed != "") {
			return a.Fixed != ""
		}
		if a.ID != b.ID {
			return a.ID < b.ID
		}
		return a.Package < b.Package
	})
	if len(report.Vulnerabilities) > 1000 {
		report.Truncated = true
		report.Vulnerabilities = report.Vulnerabilities[:1000]
	}
	if report.Packages == 0 {
		return report, errors.New("scanner returned no supported package inventory; no clean result is claimed")
	}
	return report, nil
}
func bound(v string) string {
	if len(v) > 512 {
		return v[:512]
	}
	return v
}
