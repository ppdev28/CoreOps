package security

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Service struct {
	source   Source
	slots    chan struct{}
	mutation sync.Mutex
}

func New(source Source) *Service { return &Service{source: source, slots: make(chan struct{}, 2)} }
func (s *Service) Overview(ctx context.Context) (Overview, error) {
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		return Overview{}, ErrUnavailable
	}

	o := Overview{UpdatedAt: time.Now().UTC().Format(time.RFC3339), Checks: []Check{}, Sessions: []Session{}, FirewallRules: []Rule{}, Events: []Event{}, Sources: map[string]SourceStatus{}, Capabilities: map[string]Capability{}}
	type answer struct {
		text string
		err  error
	}
	answers := map[string]answer{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, 4)
	for _, op := range []string{"ufw", "ufw-version", "sshd", "fail2ban", "apt-policy", "upgrade-timer", "ports", "events"} {
		wg.Add(1)
		go func(op string) {
			defer wg.Done()
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			case <-ctx.Done():
				return
			}
			text, e := s.source.Probe(ctx, op)
			mu.Lock()
			answers[op] = answer{text, e}
			mu.Unlock()
		}(op)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		sessionsCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
		defer cancel()
		v, state, e := s.source.Sessions(sessionsCtx)
		mu.Lock()
		defer mu.Unlock()
		if v != nil {
			o.Sessions = v
		}
		o.Sources["sessions"] = state
		if e != nil {
			o.Sources["sessions"] = Status(e)
		}
	}()
	wg.Add(1)
	go func() {
		defer wg.Done()
		cap := s.source.CanEnableAutoUpdates(ctx)
		mu.Lock()
		o.Capabilities["autoUpdates"] = cap
		mu.Unlock()
	}()
	wg.Wait()
	if ctx.Err() != nil {
		return o, ctx.Err()
	}
	for op, a := range answers {
		o.Sources[op] = Status(a.err)
	}
	fw := answers["ufw"]
	fwCheck := MakeCheck("firewall", "Firewall (ufw)", "Live UFW state is unavailable", nil)
	if fw.err != nil {
		fwCheck.Detail = fw.err.Error()
	} else {
		active, ok := Firewall(fw.text)
		if ok {
			o.FirewallActive = active
			o.FirewallRules = ParseRules(fw.text)
			fwCheck = MakeCheck(fwCheck.ID, fwCheck.Label, fmt.Sprintf("Live UFW status; %d rules read. This does not assess every rule or external firewall.", len(o.FirewallRules)), active)
		} else {
			o.Sources["ufw"] = SourceStatus{State: "error", Detail: "UFW did not return a recognized live status"}
		}
	}
	if a := answers["ufw-version"]; a.err == nil {
		o.FirewallVersion = strings.TrimSpace(strings.SplitN(a.text, "\n", 2)[0])
	}
	keys, root := SSHChecks(answers["sshd"].text, answers["sshd"].err)
	fail := MakeCheck("fail2ban", "fail2ban", "Jail status is unavailable", nil)
	if a := answers["fail2ban"]; a.err != nil {
		fail.Detail = a.err.Error()
	} else {
		for _, line := range strings.Split(a.text, "\n") {
			if i := strings.Index(line, "Number of jail:"); i >= 0 {
				n, e := strconv.Atoi(strings.TrimSpace(line[i+len("Number of jail:"):]))
				if e == nil {
					fail = MakeCheck(fail.ID, fail.Label, fmt.Sprintf("fail2ban responds; %d configured jails", n), Bool(n > 0))
				}
			}
		}
	}
	auto := AutoUpdates(answers["apt-policy"].text, answers["upgrade-timer"].text, answers["apt-policy"].err, answers["upgrade-timer"].err)
	if auto.OK == nil {
		o.Capabilities["autoUpdates"] = Capability{Reason: auto.Detail}
	} else if !*auto.OK {
		policy, known := APTPolicy(answers["apt-policy"].text)
		if !known || !policy || !SecurityOrigins(answers["apt-policy"].text) {
			o.Capabilities["autoUpdates"] = Capability{Reason: "Configure APT periodic policy on the host first; enabling the timer alone is insufficient"}
		}
	}
	ports := MakeCheck("listening-sockets", "Listening sockets", "Socket inventory unavailable", nil)
	if a := answers["ports"]; a.err == nil {
		count := 0
		for _, line := range strings.Split(a.text, "\n") {
			if strings.TrimSpace(line) != "" {
				count++
			}
		}
		ports.Detail = fmt.Sprintf("%d TCP/UDP listening endpoints. Local listening does not prove external reachability.", count)
		ports.Status = "info"
	} else {
		ports.Detail = a.err.Error()
	}
	o.Checks = []Check{fwCheck, keys, root, fail, auto, ports}
	if a := answers["events"]; a.err == nil {
		invalidRows := 0
		for _, line := range strings.Split(a.text, "\n") {
			if line == "" {
				continue
			}
			var row struct {
				Timestamp string `json:"__REALTIME_TIMESTAMP"`
				Message   string `json:"MESSAGE"`
			}
			if json.Unmarshal([]byte(line), &row) != nil {
				invalidRows++
				continue
			}
			us, e := strconv.ParseInt(row.Timestamp, 10, 64)
			if e != nil || us <= 0 || row.Message == "" {
				invalidRows++
				continue
			}
			o.Events = append(o.Events, Event{Timestamp: time.UnixMicro(us).UTC().Format(time.RFC3339Nano), Type: Classify(row.Message), Message: row.Message})
			if len(o.Events) == 200 {
				break
			}
		}
		if invalidRows > 0 {
			o.Sources["events"] = SourceStatus{State: "partial", Detail: fmt.Sprintf("%d journal records could not be decoded", invalidRows)}
		}
	}
	return o, nil
}
func (s *Service) Terminate(ctx context.Context, pid int, id string, authorize MutationGuard) (Session, error) {
	if authorize == nil {
		return Session{}, ErrPermission
	}
	if !s.mutation.TryLock() {
		return Session{}, ErrConflict
	}
	defer s.mutation.Unlock()
	if pid <= 1 || pid > 4194304 || len(id) != 64 {
		return Session{}, ErrInvalid
	}
	sessions, state, e := s.source.Sessions(ctx)
	if e != nil {
		return Session{}, e
	}
	if state.State != "ok" && state.State != "partial" {
		return Session{}, ErrUnavailable
	}
	for _, session := range sessions {
		if session.PID != pid {
			continue
		}
		if session.ID != id {
			return Session{}, ErrConflict
		}
		if !session.Verified || !session.CanTerminate {
			return session, fmt.Errorf("%w: %s", ErrPermission, session.TerminationReason)
		}
		if err := ctx.Err(); err != nil {
			return session, err
		}
		return session, authorize(func() error { return s.source.Signal(ctx, session) })
	}
	return Session{}, ErrNotFound
}
func (s *Service) EnableAutoUpdates(ctx context.Context, authorize MutationGuard) error {
	if authorize == nil {
		return ErrPermission
	}
	if !s.mutation.TryLock() {
		return ErrConflict
	}
	defer s.mutation.Unlock()
	config, ce := s.source.Probe(ctx, "apt-policy")
	timer, te := s.source.Probe(ctx, "upgrade-timer")
	before := AutoUpdates(config, timer, ce, te)
	if before.OK != nil && *before.OK {
		return authorize(func() error { return nil })
	}
	if ce != nil || te != nil {
		return ErrUnavailable
	}
	// Enabling the timer alone cannot fix disabled or unreadable APT periodic policy.
	policy, known := APTPolicy(config)
	if !known || !policy || !SecurityOrigins(config) {
		return fmt.Errorf("%w: configure effective APT periodic updates before enabling the timer", ErrConflict)
	}
	cap := s.source.CanEnableAutoUpdates(ctx)
	if !cap.Available {
		return fmt.Errorf("%w: %s", ErrPermission, cap.Reason)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if e := authorize(func() error { return s.source.EnableAutoUpdates(ctx) }); e != nil {
		return e
	}
	config, ce = s.source.Probe(ctx, "apt-policy")
	timer, te = s.source.Probe(ctx, "upgrade-timer")
	after := AutoUpdates(config, timer, ce, te)
	if after.OK == nil || !*after.OK {
		return errors.New("timer enable was requested, but automatic update scheduling could not be verified; refresh before retrying")
	}
	return nil
}
