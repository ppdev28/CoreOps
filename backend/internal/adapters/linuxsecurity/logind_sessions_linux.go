//go:build linux

package linuxsecurity

import (
	"context"
	"crypto/sha256"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	core "github.com/ppdev28/CoreOps/backend/internal/security"
)

var loginSessionID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`)
var whoISODate = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`)
var whoMonth = regexp.MustCompile(`^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$`)
var whoClock = regexp.MustCompile(`^[0-9]{2}:[0-9]{2}$`)
var loginTerminal = regexp.MustCompile(`^pts/[0-9]+$`)
var loginProperties = []string{"Id", "Name", "User", "Remote", "RemoteHost", "Service", "TTY", "State", "Timestamp", "Leader", "Scope"}

func logindArgs(ids []string) []string {
	args := []string{"show-session"}
	for _, id := range ids {
		if loginSessionID.MatchString(id) {
			args = append(args, id)
		}
	}
	// loginctl accepts repeated --property arguments. A comma-separated list returns no fields on Ubuntu.
	for _, name := range loginProperties {
		args = append(args, "--property="+name)
	}
	return append(args, "--no-pager")
}
func parseLogind(text string) []map[string]string {
	rows := []map[string]string{}
	for _, block := range strings.Split(strings.TrimSpace(text), "\n\n") {
		properties := core.Properties(block)
		if loginSessionID.MatchString(properties["Id"]) {
			rows = append(rows, properties)
		}
	}
	return rows
}
func readLogind(ctx context.Context, ids []string) ([]map[string]string, error) {
	if len(ids) == 0 {
		return []map[string]string{}, nil
	}
	if len(ids) > 128 {
		return nil, &core.SourceError{State: "partial", Detail: "Login inventory exceeded 128 sessions"}
	}
	text, err := run(ctx, "/usr/bin/loginctl", logindArgs(ids)...)
	if err != nil {
		return nil, err
	}
	rows := parseLogind(text)
	if len(rows) == 0 {
		return nil, &core.SourceError{State: "partial", Detail: "loginctl returned no recognizable session properties"}
	}
	return rows, nil
}
func loginIDFromScope(group string) string {
	for _, line := range strings.Split(group, "\n") {
		parts := strings.SplitN(line, ":", 3)
		if len(parts) != 3 {
			continue
		}
		for _, segment := range strings.Split(parts[2], "/") {
			if strings.HasPrefix(segment, "session-") && strings.HasSuffix(segment, ".scope") {
				id := strings.TrimSuffix(strings.TrimPrefix(segment, "session-"), ".scope")
				if loginSessionID.MatchString(id) {
					return id
				}
			}
		}
	}
	return ""
}

type loginRecord struct {
	User, Terminal, Since, From string
	PID                         int
}

func parseWho(text string) []loginRecord {
	records := []loginRecord{}
	for _, line := range strings.Split(text, "\n") {
		f := strings.Fields(line)
		if len(f) < 6 || !loginTerminal.MatchString(f[1]) {
			continue
		}

		pidColumn := 5
		since := ""
		if whoISODate.MatchString(f[2]) && whoClock.MatchString(f[3]) {
			since = f[2] + " " + f[3]
		} else if len(f) >= 7 && whoMonth.MatchString(f[2]) && whoClock.MatchString(f[4]) {
			day, e := strconv.Atoi(f[3])
			if e != nil || day < 1 || day > 31 {
				continue
			}
			pidColumn = 6
		} else {
			continue
		}
		pid, e := strconv.Atoi(f[pidColumn])
		if e != nil || pid <= 1 {
			continue
		}
		// C-locale who omits the year. Leave the login timestamp unknown until logind supplies it.
		r := loginRecord{User: f[0], Terminal: f[1], Since: since, PID: pid}

		if n := strings.LastIndex(line, "("); n >= 0 && strings.HasSuffix(strings.TrimSpace(line), ")") {
			r.From = strings.TrimSuffix(strings.TrimSpace(line[n+1:]), ")")
		}
		records = append(records, r)
	}
	return records
}

type processEvidence struct {
	PID, ParentPID, UID, EUID  int
	Start, Name, State, Cgroup string
	Args                       []string
}

func readProcessEvidence(pid int) (processEvidence, error) {
	root := fmt.Sprintf("/proc/%d/", pid)
	stat, e := readSmall(root + "stat")
	if e != nil {
		return processEvidence{}, e
	}
	parent, start, e := statIdentity(string(stat))
	if e != nil {
		return processEvidence{}, e
	}
	p := processEvidence{PID: pid, ParentPID: parent, Start: start, UID: -1, EUID: -1}
	fields := strings.Fields(string(stat)[strings.LastIndex(string(stat), ")")+1:])
	p.State = fields[0]
	name, e := readSmall(root + "comm")
	if e != nil {
		return p, e
	}
	p.Name = strings.TrimSpace(string(name))
	status, e := readSmall(root + "status")
	if e != nil {
		return p, e
	}
	for _, line := range strings.Split(string(status), "\n") {
		if strings.HasPrefix(line, "Uid:") {
			f := strings.Fields(line)
			if len(f) >= 3 {
				p.UID, _ = strconv.Atoi(f[1])
				p.EUID, _ = strconv.Atoi(f[2])
			}
		}
	}
	if group, e := readSmall(root + "cgroup"); e == nil {
		p.Cgroup = string(group)
	}
	// Only inspect the daemon command line; user commands can contain secrets.
	if p.Name == "tailscaled" {
		args, e := readSmall(root + "cmdline")
		if e != nil {
			return p, e
		}
		p.Args = strings.Split(strings.TrimRight(string(args), "\x00"), "\x00")
	}
	return p, nil
}
func processInScope(group, scope string) bool {
	for _, line := range strings.Split(group, "\n") {
		parts := strings.SplitN(line, ":", 3)
		if len(parts) == 3 {
			for _, segment := range strings.Split(parts[2], "/") {
				if segment == scope {
					return true
				}
			}
		}
	}
	return false
}
func tailscaleMonitor(p processEvidence, user string, uid int) bool {
	if p.Name != "tailscaled" || p.UID != 0 || p.EUID != 0 || len(p.Args) < 3 || p.Args[1] != "be-child" || p.Args[2] != "ssh-monitor" {
		return false
	}
	var localUser, localUID string
	for _, arg := range p.Args[3:] {
		if strings.HasPrefix(arg, "--local-user=") {
			localUser = strings.TrimPrefix(arg, "--local-user=")
		}
		if strings.HasPrefix(arg, "--uid=") {
			localUID = strings.TrimPrefix(arg, "--uid=")
		}
	}
	return localUser == user && localUID == strconv.Itoa(uid)
}
func tailscaleSession(boot string, login loginRecord, info map[string]string, read func(int) (processEvidence, error)) (core.Session, bool) {
	if info["Remote"] != "yes" || (info["State"] != "active" && info["State"] != "online") || info["Name"] != login.User || info["TTY"] != login.Terminal || !loginSessionID.MatchString(info["Id"]) {
		return core.Session{}, false
	}
	uid, e := strconv.Atoi(info["User"])
	if e != nil || uid < 0 {
		return core.Session{}, false
	}
	leader, e := strconv.Atoi(info["Leader"])
	if e != nil || leader <= 1 {
		return core.Session{}, false
	}
	scope := "session-" + info["Id"] + ".scope"
	if info["Scope"] != scope {
		return core.Session{}, false
	}
	shell, e := read(login.PID)
	if e != nil || shell.UID != uid || shell.EUID != uid || shell.State == "Z" || shell.State == "X" || shell.Start == "" || !processInScope(shell.Cgroup, scope) {
		return core.Session{}, false
	}
	seenLeader := false
	current := shell
	for i := 0; i < 8 && current.ParentPID > 1; i++ {
		if current.PID == leader && processInScope(current.Cgroup, scope) {
			seenLeader = true
		}
		parent, e := read(current.ParentPID)
		if e != nil {
			return core.Session{}, false
		}
		if seenLeader && tailscaleMonitor(parent, login.User, uid) {
			daemon, e := read(parent.ParentPID)
			if e != nil || daemon.Name != "tailscaled" || daemon.UID != 0 || daemon.EUID != 0 || !processInScope(daemon.Cgroup, "tailscaled.service") {
				return core.Session{}, false
			}
			id := sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%s", strings.TrimSpace(boot), shell.PID, shell.Start)))
			from := info["RemoteHost"]
			if from == "" {
				from = login.From
			}
			return core.Session{ID: fmt.Sprintf("%x", id), User: login.User, UID: uid, From: from, Since: info["Timestamp"], SinceSource: "logind", Method: "Tailscale SSH", PID: shell.PID, ParentPID: shell.ParentPID, Terminal: login.Terminal, Name: login.User + " · " + login.Terminal, LoginID: info["Id"], Process: shell.Name, StartTicks: shell.Start, Verified: false, CanTerminate: false, TerminationReason: "Tailscale SSH session detected from logind, utmp and its daemon ancestry. View only: CoreOps does not signal Tailscale's SSH processes."}, true
		}
		current = parent
	}
	return core.Session{}, false
}
func enrichLogind(sessions []core.Session, logins []map[string]string) {
	for i := range sessions {
		v := &sessions[i]
		for _, p := range logins {
			if p["Id"] != v.LoginID || p["Remote"] != "yes" || p["Name"] != v.User || p["State"] == "closing" {
				continue
			}
			if v.From == "" {
				v.From = p["RemoteHost"]
			}
			if v.Since == "" {
				v.Since = p["Timestamp"]
				v.SinceSource = "logind"
			}
		}
	}
}
