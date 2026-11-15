package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"time"

	"github.com/moby/moby/client"
)

// Docker retains a finite event buffer (normally 256); this is an honest view
// of the daemon's available events, not an invented durable event history.
func (a *API) dockerEvents(w http.ResponseWriter, r *http.Request) {
	q, err := parseJournalQuery(r.URL.Query())
	if err != nil {
		writeJSON(w, 400, ErrorResponse{Error: err.Error()})
		return
	}
	if q.cursor != "" {
		writeJSON(w, 400, ErrorResponse{Error: "Docker does not provide historical event pagination"})
		return
	}
	now := time.Now().UTC()
	since := q.since
	if since == "" {
		since = now.Add(-24 * time.Hour).Format(time.RFC3339Nano)
	}
	until := q.until
	if until == "" {
		until = now.Format(time.RFC3339Nano)
	}
	untilTime, _ := time.Parse(time.RFC3339Nano, until)
	sinceTime, _ := time.Parse(time.RFC3339Nano, since)
	if untilTime.After(now) || !sinceTime.Before(untilTime) {
		writeJSON(w, 400, ErrorResponse{Error: "Event range must end in the past and since must precede until"})
		return
	}
	if a.docker == nil {
		writeJSON(w, 502, ErrorResponse{Error: "Docker events are unavailable"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	result := a.docker.Events(ctx, client.EventsListOptions{Since: since, Until: until})
	page := LogsOverview{Entries: []LogEntry{}, Sources: []string{"Docker events"}, UpdatedAt: now.Format(time.RFC3339Nano), Warnings: []string{"Docker only returns its retained event buffer (normally the last 256 events). Events lost on daemon restart or aged out are unavailable. Default range: last 24 hours."}}
	messages, failures := result.Messages, result.Err
	for messages != nil || failures != nil {
		select {
		case message, ok := <-messages:
			if !ok {
				messages = nil
				continue
			}
			stamp := ""
			if message.TimeNano != 0 {
				stamp = time.Unix(0, message.TimeNano).UTC().Format(time.RFC3339Nano)
			} else if message.Time != 0 {
				stamp = time.Unix(message.Time, 0).UTC().Format(time.RFC3339Nano)
			}
			name := message.Actor.Attributes["name"]
			if name == "" {
				name = message.Actor.ID
			}
			text := fmt.Sprintf("%s %s %s", message.Type, message.Action, name)
			for _, key := range []string{"image", "exitCode", "signal"} {
				if value := message.Actor.Attributes[key]; value != "" {
					text += " " + key + "=" + value
				}
			}
			if len(text) > maxLogLine {
				text = text[:maxLogLine]
				page.Truncated = true
			}
			level := "INFO"
			if message.Action == "oom" {
				level = "ERROR"
			}
			page.Entries = append(page.Entries, LogEntry{Timestamp: stamp, Level: level, Source: "Docker events", Message: text, Stream: "event"})
			if len(page.Entries) > 1000 {
				page.Entries = page.Entries[1:]
				page.Truncated = true
			}
		case err, ok := <-failures:
			if !ok {
				failures = nil
				messages = nil
				continue
			}
			if err != nil && !errors.Is(err, io.EOF) {
				writeJSON(w, 502, ErrorResponse{Error: "Docker event history could not be read"})
				return
			}
			// The SDK sends over an unbuffered channel and leaves it open. EOF
			// arrives only after all messages have been delivered.
			failures = nil
			messages = nil
		case <-ctx.Done():
			writeJSON(w, 502, ErrorResponse{Error: "Docker event history exceeded its read deadline"})
			return
		}
	}
	slices.SortStableFunc(page.Entries, func(a, b LogEntry) int {
		if a.Timestamp < b.Timestamp {
			return -1
		}
		if a.Timestamp > b.Timestamp {
			return 1
		}
		return 0
	})
	writeJSON(w, 200, page)
}
