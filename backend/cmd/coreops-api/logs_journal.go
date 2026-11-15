package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os/exec"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

type journalQuery struct {
	limit                                int
	cursor, category, unit, since, until string
}

var journalCursorPattern = regexp.MustCompile(`^[a-zA-Z0-9_=;:.-]+$`)
var journalUnitPattern = regexp.MustCompile(`^[a-zA-Z0-9_@.\\:-]{1,256}$`)

func parseJournalQuery(values url.Values) (journalQuery, error) {
	q := journalQuery{limit: 300, cursor: values.Get("cursor"), category: values.Get("category"), unit: values.Get("unit"), since: values.Get("since"), until: values.Get("until")}
	if raw := values.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 1000 {
			return q, errors.New("limit must be between 1 and 1000")
		}
		q.limit = n
	}
	if !slices.Contains([]string{"", "all", "kernel", "services", "security"}, q.category) {
		return q, errors.New("unknown journal category")
	}
	if q.cursor != "" && (len(q.cursor) > 2048 || !journalCursorPattern.MatchString(q.cursor)) {
		return q, errors.New("invalid journal cursor")
	}
	if q.unit != "" && (!journalUnitPattern.MatchString(q.unit) || strings.HasPrefix(q.unit, "-")) {
		return q, errors.New("invalid systemd unit")
	}
	for _, stamp := range []string{q.since, q.until} {
		if stamp != "" {
			if _, err := time.Parse(time.RFC3339Nano, stamp); err != nil {
				return q, errors.New("time bounds must be RFC3339 timestamps")
			}
		}
	}
	if q.since != "" && q.until != "" {
		start, _ := time.Parse(time.RFC3339Nano, q.since)
		end, _ := time.Parse(time.RFC3339Nano, q.until)
		if !start.Before(end) {
			return q, errors.New("since must precede until")
		}
	}
	return q, nil
}

// A fixed argv and bounded pipes keep the journal reader separate from the shell.
// Reverse cursors traverse all retained boots; --dmesg/-k would restrict to this boot.
func collectJournalPage(ctx context.Context, q journalQuery) (LogsOverview, error) {
	page := LogsOverview{Entries: []LogEntry{}, Sources: []string{"System"}, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano), HistoryOrder: "older"}
	serviceScan := q.category == "services" && q.unit == ""
	scanLimit := q.limit + 2
	if serviceScan {
		scanLimit = 1001
	}
	args := []string{"--no-pager", "--reverse", "-n", strconv.Itoa(scanLimit), "-o", "json", "--output-fields=__CURSOR,__REALTIME_TIMESTAMP,PRIORITY,SYSLOG_IDENTIFIER,MESSAGE,_SYSTEMD_UNIT,_TRANSPORT"}
	if q.cursor != "" {
		args = append(args, "--cursor="+q.cursor)
	}
	for key, value := range map[string]string{"since": q.since, "until": q.until, "unit": q.unit} {
		if value != "" && !(key == "unit" && q.category == "security") {
			args = append(args, "--"+key+"="+value)
		}
	}
	switch q.category {
	case "kernel":
		args = append(args, "_TRANSPORT=kernel")
	case "services":
		// Do not expand a wildcard over the complete journal field index.
		// Filter unit metadata in a bounded scan and carry a real cursor.
	case "security":
		for index, match := range []string{"SYSLOG_FACILITY=4", "SYSLOG_FACILITY=10", "_TRANSPORT=audit", "SYSLOG_IDENTIFIER=sshd", "SYSLOG_IDENTIFIER=sudo", "SYSLOG_IDENTIFIER=fail2ban"} {
			if index > 0 {
				args = append(args, "+")
			}
			args = append(args, match)
			if q.unit != "" {
				args = append(args, "_SYSTEMD_UNIT="+q.unit)
			}
		}
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(ctx, "journalctl", args...)
	var stderr limitedLogWriter
	stderr.remaining = 8192
	cmd.Stderr = &stderr
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return page, err
	}
	if err = cmd.Start(); err != nil {
		return page, err
	}
	output, readErr := io.ReadAll(io.LimitReader(pipe, maxLogBytes+1))
	if len(output) > maxLogBytes || readErr != nil {
		cancel()
	}
	waitErr := cmd.Wait()
	if len(output) > maxLogBytes {
		return page, errors.New("journal page exceeds 2 MiB; choose a smaller page or narrower time range")
	}
	if readErr != nil {
		return page, readErr
	}
	if waitErr != nil {
		return page, waitErr
	}
	if stderr.Len() > 0 {
		page.Warnings = append(page.Warnings, "Journal access may be partial. Check the API service account's journal permissions and host journal configuration.")
	}
	scanner := bufio.NewScanner(bytes.NewReader(output))
	scanner.Buffer(make([]byte, 4096), maxLogBytes)
	oldest := ""
	count := 0
	scanned := 0
	for scanner.Scan() {
		var row map[string]json.RawMessage
		if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
			return page, errors.New("journal returned an invalid record")
		}
		cursor := journalField(row["__CURSOR"])
		if cursor != "" && cursor == q.cursor {
			continue
		} // --cursor includes its anchor.
		if count == q.limit {
			page.NextCursor = oldest
			break
		}
		scanned++
		if serviceScan && scanned > 1000 {
			page.NextCursor = oldest
			break
		}
		oldest = cursor
		if serviceScan && !strings.HasSuffix(journalField(row["_SYSTEMD_UNIT"]), ".service") && journalField(row["_SYSTEMD_UNIT"]) != "init.scope" && journalField(row["SYSLOG_IDENTIFIER"]) != "systemd" {
			continue
		}
		count++
		stamp := ""
		if micros, err := strconv.ParseInt(journalField(row["__REALTIME_TIMESTAMP"]), 10, 64); err == nil {
			stamp = time.UnixMicro(micros).UTC().Format(time.RFC3339Nano)
		}
		level := "INFO"
		switch journalField(row["PRIORITY"]) {
		case "0", "1", "2", "3":
			level = "ERROR"
		case "4":
			level = "WARN"
		case "5":
			level = "NOTICE"
		case "7":
			level = "DEBUG"
		}
		message := journalField(row["MESSAGE"])
		if id := journalField(row["SYSLOG_IDENTIFIER"]); id != "" {
			message = id + ": " + message
		}
		if len(message) > maxLogLine {
			message = message[:maxLogLine]
			page.Truncated = true
		}
		source := journalField(row["_SYSTEMD_UNIT"])
		if source == "" {
			source = journalField(row["_TRANSPORT"])
		}
		if source == "" {
			source = "System"
		}
		page.Entries = append(page.Entries, LogEntry{Timestamp: stamp, Level: level, Source: source, Message: message, Stream: "journal"})
		oldest = cursor
	}
	slices.Reverse(page.Entries)
	return page, scanner.Err()
}

func journalField(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var numbers []byte
	if json.Unmarshal(raw, &numbers) == nil && numbers != nil {
		return string(numbers)
	}
	var texts []string
	if json.Unmarshal(raw, &texts) == nil {
		return strings.Join(texts, " ")
	}
	return string(raw)
}

type limitedLogWriter struct {
	bytes.Buffer
	remaining int
}

func (w *limitedLogWriter) Write(p []byte) (int, error) {
	n := len(p)
	if len(p) > w.remaining {
		p = p[:w.remaining]
	}
	w.Buffer.Write(p)
	w.remaining -= len(p)
	return n, nil
}
