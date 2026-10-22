package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

type UpdatePackage struct {
	Package   string `json:"package"`
	Current   string `json:"current"`
	Available string `json:"available"`
	Type      string `json:"type"`
	Source    string `json:"source,omitempty"`
}
type UpdatesOverview struct {
	UpdatedAt     string          `json:"updatedAt"`
	Updates       []UpdatePackage `json:"updates"`
	SecurityCount int             `json:"securityCount"`
	SystemCount   int             `json:"systemCount"`
}
type ApplyUpdatesRequest struct {
	Packages []string `json:"packages"`
	All      bool     `json:"all"`
}
type ApplyUpdatesResponse struct {
	OK       bool     `json:"ok"`
	Packages []string `json:"packages"`
	Output   string   `json:"output"`
}

var aptPackageNamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9+_.:-]*(?::[a-zA-Z0-9][a-zA-Z0-9+_.-]*)?$`)

func collectUpdates(ctx context.Context) (UpdatesOverview, error) {
	out, err := runUpdateCommand(ctx, "apt", "list", "--upgradable")
	if err != nil {
		return UpdatesOverview{}, fmt.Errorf("apt list --upgradable: %w", err)
	}
	overview := UpdatesOverview{UpdatedAt: time.Now().UTC().Format(time.RFC3339), Updates: []UpdatePackage{}}
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		update, ok := parseAptUpgradableLine(scanner.Text())
		if !ok {
			continue
		}
		overview.Updates = append(overview.Updates, update)
		if update.Type == "security" {
			overview.SecurityCount++
		} else {
			overview.SystemCount++
		}
	}
	return overview, nil
}

func parseAptUpgradableLine(line string) (UpdatePackage, bool) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "Listing...") {
		return UpdatePackage{}, false
	}
	fields := strings.Fields(line)
	if len(fields) < 2 || !strings.Contains(line, "[upgradable from:") {
		return UpdatePackage{}, false
	}
	packageName := strings.SplitN(fields[0], "/", 2)[0]
	if !aptPackageNamePattern.MatchString(packageName) {
		return UpdatePackage{}, false
	}
	available := fields[1]
	if slash := strings.Index(available, "/"); slash >= 0 {
		available = available[:slash]
	}
	marker := "[upgradable from:"
	idx := strings.Index(line, marker)
	if idx < 0 {
		return UpdatePackage{}, false
	}
	rest := strings.TrimSpace(line[idx+len(marker):])
	if end := strings.Index(rest, "]"); end >= 0 {
		rest = rest[:end]
	}
	current := strings.TrimSpace(rest)
	source := ""
	if slash := strings.Index(fields[0], "/"); slash >= 0 {
		source = fields[0][slash+1:]
	}
	updateType := "system"
	lower := strings.ToLower(line)
	if strings.Contains(strings.ToLower(source), "security") || strings.Contains(lower, "-security") {
		updateType = "security"
	}
	return UpdatePackage{Package: packageName, Current: current, Available: available, Type: updateType, Source: source}, true
}

func (a *API) updates(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	overview, err := collectUpdates(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}
func (a *API) refreshUpdates(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	if _, err := runUpdateCommand(ctx, "apt-get", "update"); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	overview, err := collectUpdates(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (a *API) applyUpdates(w http.ResponseWriter, r *http.Request) {
	var req ApplyUpdatesRequest
	if err := decodeUpdatesBody(w, r, &req); err != nil {
		return
	}
	if !req.All && len(req.Packages) == 0 {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "select at least one package or set all=true"})
		return
	}
	packages := uniqueValidPackages(req.Packages)
	if !req.All && len(packages) != len(req.Packages) {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid package name"})
		return
	}
	displayPackages := append([]string(nil), packages...)
	if req.All {
		displayPackages = []string{"all available packages"}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Minute)
	defer cancel()
	var out string
	var err error
	if req.All {
		out, err = runUpdateCommand(ctx, "apt-get", "-y", "--with-new-pkgs", "upgrade")
	} else {
		args := append([]string{"-y", "--only-upgrade", "install"}, packages...)
		out, err = runUpdateCommand(ctx, "apt-get", args...)
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("apply updates: %w", err))
		return
	}
	writeJSON(w, http.StatusOK, ApplyUpdatesResponse{OK: true, Packages: displayPackages, Output: trimCommandOutput(out)})
}

func runUpdateCommand(ctx context.Context, name string, args ...string) (string, error) {
	env := append([]string{}, os.Environ()...)
	env = append(env, "DEBIAN_FRONTEND=noninteractive")
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = env
	out, err := cmd.CombinedOutput()
	if err == nil {
		return string(out), nil
	}
	if os.Geteuid() != 0 {
		sudo := exec.CommandContext(ctx, "sudo", append([]string{"-n", name}, args...)...)
		sudo.Env = env
		sudoOut, sudoErr := sudo.CombinedOutput()
		if sudoErr == nil {
			return string(sudoOut), nil
		}
		if len(sudoOut) > 0 {
			return string(sudoOut), sudoErr
		}
	}
	return string(out), err
}
func uniqueValidPackages(input []string) []string {
	result := make([]string, 0, len(input))
	seen := map[string]bool{}
	for _, raw := range input {
		pkg := strings.TrimSpace(raw)
		if pkg == "" || !aptPackageNamePattern.MatchString(pkg) || seen[pkg] {
			continue
		}
		seen[pkg] = true
		result = append(result, pkg)
	}
	return result
}
func trimCommandOutput(output string) string {
	const max = 12000
	if len(output) <= max {
		return output
	}
	return output[len(output)-max:]
}
func decodeUpdatesBody(w http.ResponseWriter, r *http.Request, dst any) error {
	if r.Body == nil {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "request body is required"})
		return fmt.Errorf("request body is required")
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024))
	if err := decoder.Decode(dst); err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid request body"})
		return err
	}
	return nil
}
