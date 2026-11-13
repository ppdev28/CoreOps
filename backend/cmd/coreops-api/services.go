package main

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type SystemService struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Enabled     bool   `json:"enabled"`
	CPU         string `json:"cpu"`
	Memory      string `json:"memory"`
	Uptime      string `json:"uptime"`
}

var systemdUnitPattern = regexp.MustCompile(`^[a-zA-Z0-9@_.:-]+\.service$`)

func collectServices(ctx context.Context) ([]SystemService, error) {
	out, err := runSystemctl(ctx, "list-units", "--type=service", "--all", "--no-legend", "--no-pager")
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	services := make([]SystemService, 0, len(lines))
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 4 || !systemdUnitPattern.MatchString(fields[0]) {
			continue
		}
		name := fields[0]
		description := strings.TrimSpace(strings.Join(fields[4:], " "))
		status := "inactive"
		switch fields[2] {
		case "active":
			status = "active"
		case "failed":
			status = "failed"
		}
		service, err := inspectSystemdService(ctx, name)
		if err != nil {
			continue
		}
		service.ID = name
		service.Name = name
		service.Description = description
		service.Status = status
		services = append(services, service)
	}
	return services, nil
}

func inspectSystemdService(ctx context.Context, name string) (SystemService, error) {
	out, err := runSystemctl(ctx, "show", name, "--no-pager", "--property=Description,ActiveState,UnitFileState,MainPID,CPUUsageNSec,MemoryCurrent,ActiveEnterTimestamp")
	if err != nil {
		return SystemService{}, err
	}
	values := make(map[string]string)
	for _, line := range strings.Split(out, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok {
			values[key] = value
		}
	}
	status := values["ActiveState"]
	if status != "active" && status != "failed" {
		status = "inactive"
	}
	cpu := "—"
	if ns, err := strconv.ParseUint(values["CPUUsageNSec"], 10, 64); err == nil && ns > 0 {
		cpu = formatCPUTime(ns)
	}
	memory := "—"
	if bytes, err := strconv.ParseInt(values["MemoryCurrent"], 10, 64); err == nil && bytes >= 0 {
		memory = formatBytes(bytes)
	}
	enabled := values["UnitFileState"] == "enabled" || values["UnitFileState"] == "enabled-runtime" || values["UnitFileState"] == "static"
	uptime := "—"
	if status == "active" {
		uptime = formatServiceUptime(values["ActiveEnterTimestamp"])
	}
	return SystemService{Description: values["Description"], Status: status, Enabled: enabled, CPU: cpu, Memory: memory, Uptime: uptime}, nil
}

func serviceAction(ctx context.Context, name, action string) error {
	if !systemdUnitPattern.MatchString(name) {
		return fmt.Errorf("invalid systemd service name")
	}
	switch action {
	case "start", "stop", "restart":
	default:
		return fmt.Errorf("invalid service action")
	}
	_, err := runSystemctl(ctx, action, name)
	return err
}

func runSystemctl(ctx context.Context, args ...string) (string, error) {
	commandCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(commandCtx, "systemctl", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(out))
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("systemctl: %s", message)
	}
	return string(out), nil
}

func formatBytes(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	}
	units := []string{"KB", "MB", "GB", "TB"}
	value := float64(bytes)
	for _, unit := range units {
		value /= 1024
		if value < 1024 {
			return fmt.Sprintf("%.1f %s", value, unit)
		}
	}
	return fmt.Sprintf("%.1f PB", value/1024)
}

func formatCPUTime(ns uint64) string {
	seconds := float64(ns) / 1e9
	if seconds < 60 {
		return fmt.Sprintf("%.1fs", seconds)
	}
	return fmt.Sprintf("%dm", int(seconds/60))
}

func formatServiceUptime(timestamp string) string {
	if timestamp == "" {
		return "—"
	}
	const layout = "Mon 2006-01-02 15:04:05 MST"
	started, err := time.Parse(layout, timestamp)
	if err != nil {
		return "—"
	}
	d := time.Since(started)
	if d < 0 {
		return "—"
	}
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60
	if days > 0 {
		return fmt.Sprintf("%dd %dh", days, hours)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	return fmt.Sprintf("%dm", minutes)
}
