// Package security owns evidence-based host checks and verified SSH actions.
package security

import (
	"context"
	"errors"
)

type Check struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	OK     *bool  `json:"ok"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}
type SourceStatus struct {
	State  string `json:"state"`
	Detail string `json:"detail,omitempty"`
}
type Capability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}
type Session struct {
	ID                string `json:"id"`
	User              string `json:"user"`
	UID               int    `json:"uid"`
	From              string `json:"from"`
	Since             string `json:"since"`
	SinceSource       string `json:"sinceSource,omitempty"`
	Method            string `json:"method"`
	PID               int    `json:"pid"`
	ParentPID         int    `json:"parentPid"`
	Terminal          string `json:"terminal"`
	Name              string `json:"name"`
	LoginID           string `json:"loginId,omitempty"`
	Process           string `json:"process"`
	StartTicks        string `json:"-"`
	Verified          bool   `json:"verified"`
	CanTerminate      bool   `json:"canTerminate"`
	TerminationReason string `json:"terminationReason,omitempty"`
}
type Rule struct {
	Number  string `json:"number"`
	To      string `json:"to"`
	Action  string `json:"action"`
	From    string `json:"from"`
	Comment string `json:"comment,omitempty"`
}
type Event struct {
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	Message   string `json:"message"`
}
type Overview struct {
	UpdatedAt       string                  `json:"updatedAt"`
	Checks          []Check                 `json:"checks"`
	Sessions        []Session               `json:"sessions"`
	FirewallActive  *bool                   `json:"firewallActive"`
	FirewallRules   []Rule                  `json:"firewallRules"`
	FirewallVersion string                  `json:"firewallVersion"`
	Events          []Event                 `json:"events"`
	Sources         map[string]SourceStatus `json:"sources"`
	Capabilities    map[string]Capability   `json:"capabilities"`
}
type Source interface {
	Probe(context.Context, string) (string, error)
	Sessions(context.Context) ([]Session, SourceStatus, error)
	Signal(context.Context, Session) error
	EnableAutoUpdates(context.Context) error
	CanEnableAutoUpdates(context.Context) Capability
}

var ErrNotFound = errors.New("verified SSH session no longer exists")
var ErrConflict = errors.New("Security precondition failed; refresh and review the resource")
var ErrPermission = errors.New("host permission denied")
var ErrUnavailable = errors.New("host source unavailable")
var ErrUnsupported = errors.New("operation is not supported by this host")
var ErrInvalid = errors.New("invalid security request")

type SourceError struct{ State, Detail string }

func (e *SourceError) Error() string { return e.Detail }
func Status(err error) SourceStatus {
	if err == nil {
		return SourceStatus{State: "ok"}
	}
	var source *SourceError
	if errors.As(err, &source) {
		return SourceStatus{State: source.State, Detail: source.Detail}
	}
	return SourceStatus{State: "error", Detail: err.Error()}
}
