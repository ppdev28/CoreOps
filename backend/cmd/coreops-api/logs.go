package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"io"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/moby/moby/client"
)

type LogEntry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Source    string `json:"source"`
	Message   string `json:"message"`
}

type LogsOverview struct {
	Entries   []LogEntry `json:"entries"`
	Sources   []string   `json:"sources"`
	UpdatedAt string     `json:"updatedAt"`
}

func collectLogs(ctx context.Context, docker *client.Client) (LogsOverview, error) {
	entries := make([]LogEntry, 0, 500)

	if systemEntries, err := collectJournalLogs(ctx); err == nil {
		entries = append(entries, systemEntries...)
	}

	containers, err := docker.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		return LogsOverview{}, err
	}
	for _, item := range containers.Items {
		name := item.ID
		if len(item.Names) > 0 {
			name = strings.TrimPrefix(item.Names[0], "/")
		}
		if name == "" {
			name = item.ID[:minInt(12, len(item.ID))]
		}
		containerEntries, err := collectContainerLogs(ctx, docker, item.ID, name)
		if err == nil {
			entries = append(entries, containerEntries...)
		}
	}

	sort.SliceStable(entries, func(i, j int) bool { return entries[i].Timestamp < entries[j].Timestamp })
	if len(entries) > 500 {
		entries = entries[len(entries)-500:]
	}

	sources := []string{"All"}
	seen := map[string]bool{"All": true}
	for _, entry := range entries {
		if !seen[entry.Source] {
			seen[entry.Source] = true
			sources = append(sources, entry.Source)
		}
	}
	sort.Strings(sources[1:])

	return LogsOverview{Entries: entries, Sources: sources, UpdatedAt: time.Now().UTC().Format(time.RFC3339)}, nil
}

func collectJournalLogs(ctx context.Context) ([]LogEntry, error) {
	cmd := exec.CommandContext(ctx, "journalctl", "--no-pager", "-n", "300", "-o", "short-iso")
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	entries := make([]LogEntry, 0, 300)
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "-- Logs begin") || strings.HasPrefix(line, "-- No entries") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 3 {
			continue
		}
		timestamp := parts[0] + " " + parts[1]
		message := strings.Join(parts[2:], " ")
		entries = append(entries, LogEntry{Timestamp: timestamp, Level: inferLogLevel(message), Source: "System", Message: message})
	}
	return entries, scanner.Err()
}

func collectContainerLogs(ctx context.Context, docker *client.Client, id, name string) ([]LogEntry, error) {
	result, err := docker.ContainerLogs(ctx, id, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true, Timestamps: true, Tail: "100"})
	if err != nil {
		return nil, err
	}
	defer result.Close()

	data, err := io.ReadAll(result)
	if err != nil {
		return nil, err
	}

	entries := make([]LogEntry, 0, 100)
	for len(data) >= 8 {
		size := int(binary.BigEndian.Uint32(data[4:8]))
		if size < 0 || size > len(data)-8 {
			break
		}
		payload := string(data[8 : 8+size])
		data = data[8+size:]
		parseContainerLogPayload(payload, name, &entries)
	}
	if len(entries) == 0 && len(data) > 0 {
		parseContainerLogPayload(string(data), name, &entries)
	}
	return entries, nil
}

func parseContainerLogPayload(payload, source string, entries *[]LogEntry) {
	scanner := bufio.NewScanner(strings.NewReader(payload))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		timestamp := ""
		message := line
		if len(parts) >= 2 && strings.Contains(parts[0], "T") {
			timestamp = parts[0]
			message = strings.Join(parts[1:], " ")
		}
		if timestamp == "" {
			timestamp = time.Now().UTC().Format(time.RFC3339)
		}
		*entries = append(*entries, LogEntry{Timestamp: timestamp, Level: inferLogLevel(message), Source: source, Message: message})
	}
}

func inferLogLevel(message string) string {
	upper := strings.ToUpper(message)
	switch {
	case strings.Contains(upper, "ERROR"), strings.Contains(upper, "ERR"), strings.Contains(upper, "FATAL"), strings.Contains(upper, "PANIC"):
		return "ERROR"
	case strings.Contains(upper, "WARN"), strings.Contains(upper, "WARNING"):
		return "WARN"
	case strings.Contains(upper, "NOTICE"):
		return "notice"
	default:
		return "INFO"
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
