package security

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"
)

type Checkpoint struct {
	Cursor        string `json:"cursor"`
	LastCollected string `json:"lastCollected"`
	CoverageSince string `json:"coverageSince"`
}
type CheckpointStore interface {
	Load() (Checkpoint, error)
	Save(Checkpoint) error
}
type MonitorStatus struct {
	State          string   `json:"state"`
	Detail         string   `json:"detail"`
	LastCollected  string   `json:"lastCollected"`
	CoverageSince  string   `json:"coverageSince"`
	Backlog        bool     `json:"backlog"`
	RetainedEvents int      `json:"retainedEvents"`
	Signals        []Signal `json:"signals"`
}
type Monitor struct {
	mu         sync.Mutex
	view       sync.RWMutex
	source     EventSource
	store      CheckpointStore
	checkpoint Checkpoint
	events     []Event
	status     MonitorStatus
	loaded     bool
}

func NewMonitor(source EventSource, store CheckpointStore) *Monitor {
	return &Monitor{source: source, store: store, status: MonitorStatus{State: "starting", Detail: "Waiting for journal evidence", Signals: []Signal{}}, events: []Event{}}
}
func (m *Monitor) Status() MonitorStatus {
	m.view.RLock()
	defer m.view.RUnlock()
	s := m.status
	s.Signals = append([]Signal{}, s.Signals...)
	return s
}
func (m *Monitor) Run(ctx context.Context) {
	m.Collect(ctx)
	timer := time.NewTicker(10 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			m.Collect(ctx)
		}
	}
}
func (m *Monitor) Collect(ctx context.Context) {
	if !m.mu.TryLock() {
		return
	}
	defer m.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	status := m.Status()
	defer func() { m.view.Lock(); m.status = status; m.view.Unlock() }()
	if !m.loaded {
		cp, err := m.store.Load()
		if err != nil {
			status.State = "error"
			status.Detail = "Security checkpoint cannot be read safely; collection is blocked"
			return
		}
		m.checkpoint = cp
		m.loaded = true
	}
	for page := 0; page < 20; page++ {
		direction := "newer"
		if m.checkpoint.Cursor == "" {
			direction = "older"
		}
		p, err := m.source.Events(ctx, EventQuery{Category: "all", Cursor: m.checkpoint.Cursor, Direction: direction, Limit: 200})
		if err != nil || p.Source.State != "ok" {
			status.State = "partial"
			status.Detail = "Journal collection is incomplete. The saved cursor has not advanced; inspect access, journal retention or malformed records before resetting."
			if err == nil && p.Source.Detail != "" {
				status.Detail += " " + p.Source.Detail
			}
			return
		}
		checkpoint := m.checkpoint
		if p.UpdatedAt != "" {
			checkpoint.LastCollected = p.UpdatedAt
		}
		if p.NewestCursor != "" {
			checkpoint.Cursor = p.NewestCursor
			checkpoint.LastCollected = p.UpdatedAt
			if checkpoint.CoverageSince == "" && len(p.Events) > 0 {
				checkpoint.CoverageSince = p.Events[len(p.Events)-1].Timestamp
			}
		}
		if err := m.store.Save(checkpoint); err != nil {
			status.State = "error"
			status.Detail = "Security checkpoint could not be persisted; collection has not advanced"
			return
		}
		m.checkpoint = checkpoint
		seen := map[string]bool{}
		for _, e := range m.events {
			seen[e.ID] = true
		}
		for _, e := range p.Events {
			if !seen[e.ID] {
				m.events = append(m.events, e)
				seen[e.ID] = true
			}
		}
		sort.Slice(m.events, func(i, j int) bool { return m.events[i].Timestamp < m.events[j].Timestamp })
		if len(m.events) > 2000 {
			m.events = append([]Event{}, m.events[len(m.events)-2000:]...)
		}
		status = MonitorStatus{State: "ok", Detail: "Journal collection active. Signals are bounded heuristics, not confirmed attacks; sensor coverage is reported separately.", LastCollected: checkpoint.LastCollected, CoverageSince: checkpoint.CoverageSince, RetainedEvents: len(m.events), Signals: AnalyzeEvents(m.events), Backlog: p.HasMore && direction == "newer"}
		if direction == "older" || !p.HasMore {
			return
		}
	}
	status.State = "partial"
	status.Detail = "Journal backlog remains; the next cycle continues from the saved cursor without skipping pages"
	status.Backlog = true
}
func (m *Monitor) Reset(authorize func() error) error {
	if !m.mu.TryLock() {
		return ErrConflict
	}
	defer m.mu.Unlock()
	if authorize == nil {
		return ErrPermission
	}
	if err := authorize(); err != nil {
		return err
	}
	if err := m.store.Save(Checkpoint{}); err != nil {
		return errors.New("could not reset Security checkpoint")
	}
	m.checkpoint = Checkpoint{}
	m.loaded = true
	m.events = []Event{}
	m.view.Lock()
	defer m.view.Unlock()
	m.status = MonitorStatus{State: "starting", Detail: "Explicit reset acknowledged; next collection starts at the latest journal window. Earlier coverage is not claimed.", Signals: []Signal{}}
	return nil
}
