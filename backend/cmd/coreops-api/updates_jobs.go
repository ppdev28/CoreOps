package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type updateRunner interface {
	Check(context.Context) error
	List(context.Context) (UpdatesOverview, error)
	Run(context.Context, string, []string) (string, error)
}
type UpdateCapability struct {
	Available bool   `json:"available"`
	Error     string `json:"error,omitempty"`
}
type UpdateJob struct {
	ID         string           `json:"id"`
	Action     string           `json:"action"`
	Status     string           `json:"status"`
	Packages   []string         `json:"packages"`
	StartedAt  string           `json:"startedAt"`
	FinishedAt string           `json:"finishedAt,omitempty"`
	Output     string           `json:"output"`
	Error      string           `json:"error,omitempty"`
	Warning    string           `json:"warning,omitempty"`
	Overview   *UpdatesOverview `json:"overview,omitempty"`
}
type updateJobs struct {
	mu      sync.Mutex
	runner  updateRunner
	audit   *AuditLog
	jobs    map[string]UpdateJob
	latest  string
	active  string
	cap     UpdateCapability
	checked time.Time
}

func newUpdateJobs(runner updateRunner, audit *AuditLog) *updateJobs {
	return &updateJobs{runner: runner, audit: audit, jobs: map[string]UpdateJob{}}
}
func (j *updateJobs) capability(ctx context.Context) UpdateCapability {
	j.mu.Lock()
	defer j.mu.Unlock()
	if time.Since(j.checked) < 30*time.Second {
		return j.cap
	}
	call, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	e := j.runner.Check(call)
	j.cap = UpdateCapability{Available: e == nil}
	if e != nil {
		j.cap.Error = e.Error()
	}
	j.checked = time.Now()
	return j.cap
}
func (j *updateJobs) start(action string, packages []string, user User) (UpdateJob, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.active != "" {
		return j.jobs[j.active], errors.New("another package operation is already running")
	}
	raw := make([]byte, 16)
	if _, e := rand.Read(raw); e != nil {
		return UpdateJob{}, e
	}
	job := UpdateJob{ID: hex.EncodeToString(raw), Action: action, Packages: append([]string{}, packages...), Status: "running", StartedAt: time.Now().UTC().Format(time.RFC3339)}
	// Keep bounded metadata/output in memory; jobs survive browser reload/navigation,
	// never replay a mutation after an API restart.
	if len(j.jobs) >= 16 {
		for id := range j.jobs {
			delete(j.jobs, id)
			break
		}
	}
	j.jobs[job.ID] = job
	j.latest = job.ID
	j.active = job.ID
	go j.execute(job, user)
	return job, nil
}
func (j *updateJobs) execute(job UpdateJob, user User) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	output, err := j.runner.Run(ctx, job.Action, job.Packages)
	job.Output = trimCommandOutput(output)
	job.Status = "succeeded"
	status := 200
	if err != nil {
		job.Status = "failed"
		job.Error = err.Error()
		status = 502
	} else {
		overview, e := j.runner.List(ctx)
		if e != nil {
			job.Warning = "Operation completed, but reading the updated package index failed: " + e.Error()
		} else {
			job.Overview = &overview
		}
	}
	job.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	j.mu.Lock()
	j.jobs[job.ID] = job
	j.active = ""
	j.checked = time.Time{}
	j.mu.Unlock()
	if j.audit != nil {
		j.audit.Append(AuditEntry{Time: time.Now().UTC(), User: user.Name, Role: user.Role, Method: "JOB", Path: "/api/v1/updates/jobs/" + job.ID, Status: status, Detail: fmt.Sprintf("%s %s packages=%d", job.Action, job.Status, len(job.Packages))})
	}
}
func (a *API) updateJob(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	j := a.updateTasks
	j.mu.Lock()
	defer j.mu.Unlock()
	id := r.PathValue("id")
	if id == "current" {
		id = j.latest
		if id == "" {
			writeJSON(w, 200, nil)
			return
		}
	}
	job, ok := j.jobs[id]
	if !ok {
		writeError(w, 404, errors.New("update job status is unavailable; if CoreOps restarted, check APT/dpkg before retrying"))
		return
	}
	writeJSON(w, 200, job)
}
func (a *API) startUpdateJob(w http.ResponseWriter, r *http.Request, action string, packages []string) {
	if capability := a.updateTasks.capability(r.Context()); !capability.Available {
		writeError(w, 503, errors.New(capability.Error))
		return
	}
	user, _ := userFromContext(r.Context())
	job, e := a.updateTasks.start(action, packages, user)
	if e != nil {
		if job.ID != "" {
			writeError(w, 409, errors.New("another update job is running; check its status before starting another"))
		} else {
			writeError(w, 500, e)
		}
		return
	}
	setAuditDetail(r, action+" job="+job.ID)
	w.Header().Set("Location", "/api/v1/updates/jobs/"+job.ID)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 202, job)
}
