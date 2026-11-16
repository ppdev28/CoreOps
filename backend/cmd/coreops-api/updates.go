package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	UpdatedAt     string            `json:"updatedAt"`
	Updates       []UpdatePackage   `json:"updates"`
	SecurityCount int               `json:"securityCount"`
	SystemCount   int               `json:"systemCount"`
	Capability    *UpdateCapability `json:"capability,omitempty"`
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
	if err := scanner.Err(); err != nil {
		return overview, fmt.Errorf("reading package listing: %w", err)
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
	overview, err := a.updateTasks.runner.List(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	capability := a.updateTasks.capability(r.Context())
	overview.Capability = &capability
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, overview)
}
func (a *API) refreshUpdates(w http.ResponseWriter, r *http.Request) {
	a.startUpdateJob(w, r, "refresh", nil)
}
func (a *API) applyUpdates(w http.ResponseWriter, r *http.Request) {
	var req ApplyUpdatesRequest
	if err := decodeUpdatesBody(w, r, &req); err != nil {
		return
	}
	if req.All && len(req.Packages) > 0 || len(req.Packages) > 100 || !req.All && len(req.Packages) == 0 {
		writeError(w, 400, fmt.Errorf("choose all=true or 1–100 package names"))
		return
	}
	packages := uniqueValidPackages(req.Packages)
	if len(packages) != len(req.Packages) {
		writeError(w, 400, fmt.Errorf("invalid or duplicate package name"))
		return
	}
	action := "apply"
	if req.All {
		action = "upgrade"
	}
	a.startUpdateJob(w, r, action, packages)
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
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid request body"})
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		writeError(w, 400, fmt.Errorf("unexpected trailing request data"))
		return fmt.Errorf("trailing data")
	}
	return nil
}
