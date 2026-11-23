package security

import (
	"context"
	"errors"
	"regexp"
	"sync"
	"time"
)

type ScanTarget struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}
type ScanCapability struct {
	Available bool         `json:"available"`
	Reason    string       `json:"reason"`
	Hostname  string       `json:"hostname"`
	BootID    string       `json:"bootId"`
	Version   string       `json:"version"`
	Targets   []ScanTarget `json:"targets"`
}
type Vulnerability struct {
	Status    string `json:"status"`
	ID        string `json:"id"`
	Package   string `json:"package"`
	Installed string `json:"installed"`
	Fixed     string `json:"fixed"`
	Severity  string `json:"severity"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Target    string `json:"target"`
}
type ScanReport struct {
	UniqueAdvisories  int             `json:"uniqueAdvisories"`
	FixAvailable      int             `json:"fixAvailable"`
	Scanner           string          `json:"scanner"`
	ScannedAt         string          `json:"scannedAt"`
	DatabaseUpdatedAt string          `json:"databaseUpdatedAt"`
	OS                string          `json:"os"`
	EndOfLife         bool            `json:"endOfLife"`
	Packages          int             `json:"packages"`
	Vulnerabilities   []Vulnerability `json:"vulnerabilities"`
	Counts            map[string]int  `json:"counts"`
	Truncated         bool            `json:"truncated"`
	Coverage          string          `json:"coverage"`
}
type ScanRequest struct {
	Target    string `json:"target"`
	Hostname  string `json:"hostname"`
	BootID    string `json:"bootId"`
	RequestID string `json:"requestId"`
}
type ScanJob struct {
	ID         string      `json:"id"`
	Target     string      `json:"target"`
	Status     string      `json:"status"`
	StartedAt  string      `json:"startedAt"`
	FinishedAt string      `json:"finishedAt,omitempty"`
	Error      string      `json:"error,omitempty"`
	Report     *ScanReport `json:"report,omitempty"`
}
type Scanner interface {
	Capabilities(context.Context) (ScanCapability, error)
	Scan(context.Context, string) (ScanReport, error)
}
type ScanJobs struct {
	mu      sync.Mutex
	scanner Scanner
	root    context.Context
	jobs    []ScanJob
	actors  map[string]string
}

func NewScanJobs(ctx context.Context, scanner Scanner) *ScanJobs {
	return &ScanJobs{scanner: scanner, root: ctx, jobs: []ScanJob{}, actors: map[string]string{}}
}

var scanID = regexp.MustCompile(`^[a-f0-9]{32}$`)
var imageID = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

func (s *ScanJobs) Capabilities(ctx context.Context) (ScanCapability, error) {
	return s.scanner.Capabilities(ctx)
}
func (s *ScanJobs) Jobs() []ScanJob {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]ScanJob{}, s.jobs...)
}
func (s *ScanJobs) Start(ctx context.Context, r ScanRequest, actor string, authorize func() error) (ScanJob, error) {
	if !scanID.MatchString(r.RequestID) || (r.Target != "host" && !imageID.MatchString(r.Target)) || actor == "" || authorize == nil {
		return ScanJob{}, ErrInvalid
	}
	if !s.mu.TryLock() {
		return ScanJob{}, ErrConflict
	}
	defer s.mu.Unlock()
	for _, job := range s.jobs {
		if job.ID == r.RequestID {
			if s.actors[job.ID] != actor+":"+r.Target+":"+r.Hostname+":"+r.BootID {
				return ScanJob{}, ErrConflict
			}
			return job, nil
		}
		if job.Status == "running" {
			return ScanJob{}, ErrConflict
		}
	}
	caps, err := s.scanner.Capabilities(ctx)
	if err != nil {
		return ScanJob{}, err
	}
	if !caps.Available {
		return ScanJob{}, ErrUnavailable
	}
	if r.Hostname == "" || r.BootID == "" || r.Hostname != caps.Hostname || r.BootID != caps.BootID {
		return ScanJob{}, ErrConflict
	}
	found := false
	for _, target := range caps.Targets {
		if target.ID == r.Target {
			found = true
			break
		}
	}
	if !found {
		return ScanJob{}, ErrNotFound
	}
	if err = ctx.Err(); err != nil {
		return ScanJob{}, err
	}
	if err = authorize(); err != nil {
		return ScanJob{}, err
	}
	job := ScanJob{ID: r.RequestID, Target: r.Target, Status: "running", StartedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if len(s.jobs) >= 8 {
		delete(s.actors, s.jobs[len(s.jobs)-1].ID)
		s.jobs = s.jobs[:7]
	}
	s.jobs = append([]ScanJob{job}, s.jobs...)
	s.actors[job.ID] = actor + ":" + r.Target + ":" + r.Hostname + ":" + r.BootID
	go s.run(job)
	return job, nil
}
func (s *ScanJobs) run(job ScanJob) {
	ctx, cancel := context.WithTimeout(s.root, 6*time.Minute)
	defer cancel()
	report, err := s.scanner.Scan(ctx, job.Target)
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.jobs {
		if s.jobs[i].ID != job.ID {
			continue
		}
		v := &s.jobs[i]
		v.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err != nil {
			v.Status = "failed"
			v.Error = "Scan incomplete. Check scanner installation, database connectivity, permissions and target availability; no clean result is claimed."
			return
		}
		v.Status = "succeeded"
		v.Report = &report
		return
	}
}
func NoScanner() Scanner { return unavailableScanner{} }

type unavailableScanner struct{}

func (unavailableScanner) Capabilities(context.Context) (ScanCapability, error) {
	return ScanCapability{Reason: "Configure the local Trivy scanner to assess host OS packages and immutable local images", Targets: []ScanTarget{}}, nil
}
func (unavailableScanner) Scan(context.Context, string) (ScanReport, error) {
	return ScanReport{}, errors.New("scanner unavailable")
}
