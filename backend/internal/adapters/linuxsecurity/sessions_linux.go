//go:build linux

package linuxsecurity

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"

	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"golang.org/x/sys/unix"
)

func rootOwned(st os.FileInfo) bool { v, ok := st.Sys().(*syscall.Stat_t); return ok && v.Uid == 0 }

var authenticatedTitle = regexp.MustCompile(`^(?:sshd|sshd-session): ([^ @]+)@((?:pts/[0-9]+|tty[0-9]+)(?:,(?:pts/[0-9]+|tty[0-9]+))*|notty)$`)

func statIdentity(raw string) (ppid int, start string, err error) {
	i := strings.LastIndex(raw, ")")
	if i < 0 {
		return 0, "", core.ErrInvalid
	}
	f := strings.Fields(raw[i+1:])
	if len(f) < 20 {
		return 0, "", core.ErrInvalid
	}
	p, e := strconv.Atoi(f[1])
	if e != nil {
		return 0, "", e
	}
	if _, e = strconv.ParseUint(f[19], 10, 64); e != nil {
		return 0, "", e
	}
	return p, f[19], nil
}
func readSmall(path string) ([]byte, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	b := make([]byte, 65537)
	n, e := f.Read(b)
	if n > 65536 {
		return nil, core.ErrUnavailable
	}
	if n > 0 {
		return b[:n], nil
	}
	return nil, e
}
func trustedExecutable(pid int) bool {
	path, e := os.Readlink(fmt.Sprintf("/proc/%d/exe", pid))
	if e != nil {
		return false
	}
	switch path {
	case "/usr/sbin/sshd", "/usr/lib/openssh/sshd-session", "/usr/libexec/openssh/sshd-session":
	default:
		return false
	}
	st, e := os.Stat(path)
	return e == nil && rootOwned(st) && st.Mode().IsRegular() && st.Mode().Perm()&0022 == 0
}
func (s *Source) identity(pid int, boot string) (core.Session, error) {
	base := fmt.Sprintf("/proc/%d/", pid)
	raw, e := readSmall(base + "stat")
	if e != nil {
		return core.Session{}, e
	}
	ppid, start, e := statIdentity(string(raw))
	if e != nil {
		return core.Session{}, e
	}
	cmd, e := readSmall(base + "cmdline")
	if e != nil {
		return core.Session{}, e
	}
	title := strings.TrimSpace(strings.ReplaceAll(string(cmd), "\x00", " "))
	m := authenticatedTitle.FindStringSubmatch(title)
	if len(m) != 3 {
		return core.Session{}, core.ErrNotFound
	}
	status, e := readSmall(base + "status")
	if e != nil {
		return core.Session{}, e
	}
	uid := -1
	for _, line := range strings.Split(string(status), "\n") {
		if strings.HasPrefix(line, "Uid:") {
			f := strings.Fields(line)
			if len(f) > 1 {
				uid, _ = strconv.Atoi(f[1])
			}
		}
	}
	h := sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%s", strings.TrimSpace(boot), pid, start)))
	v := core.Session{ID: fmt.Sprintf("%x", h), User: m[1], UID: uid, PID: pid, ParentPID: ppid, Terminal: m[2], Name: m[1] + " · " + m[2], Process: "sshd", Method: "SSH", StartTicks: start}
	v.Verified = boot != "" && trustedExecutable(pid) && trustedExecutable(ppid) && uid >= 0
	v.TerminationReason = "SSH process identity or executable cannot be verified with current host permissions"
	if v.Verified {
		v.TerminationReason = "The API user cannot signal this SSH process"
		if protected(pid) {
			v.TerminationReason = "This process is an ancestor of CoreOps and cannot be terminated here"
		} else {
			fd, e := unix.PidfdOpen(pid, 0)
			if e == nil {
				defer unix.Close(fd)
				e = unix.PidfdSendSignal(fd, 0, nil, 0)
				if e == nil {
					v.CanTerminate = true
					v.TerminationReason = ""
				}
			}
		}
	}
	if cgroup, e := readSmall(base + "cgroup"); e == nil {
		for _, part := range strings.Split(string(cgroup), "/") {
			if strings.HasPrefix(part, "session-") && strings.HasSuffix(strings.TrimSpace(part), ".scope") {
				v.LoginID = strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(part), "session-"), ".scope")
			}
		}
	}
	return v, nil
}
func protected(pid int) bool {
	p := os.Getpid()
	for i := 0; i < 128 && p > 1; i++ {
		if p == pid {
			return true
		}
		b, e := readSmall(fmt.Sprintf("/proc/%d/stat", p))
		if e != nil {
			break
		}
		next, _, e := statIdentity(string(b))
		if e != nil || next == p {
			break
		}
		p = next
	}
	return pid <= 1
}
func (s *Source) Sessions(ctx context.Context) ([]core.Session, core.SourceStatus, error) {
	result := []core.Session{}
	boot, e := readSmall("/proc/sys/kernel/random/boot_id")
	if e != nil {
		return result, core.Status(e), e
	}
	out, e := run(ctx, "/usr/bin/ps", "-eo", "pid=,comm=")
	if e != nil {
		return result, core.Status(e), e
	}
	state := core.SourceStatus{State: "ok"}
	candidates := 0
	for _, line := range strings.Split(out, "\n") {
		if ctx.Err() != nil {
			return result, core.Status(ctx.Err()), ctx.Err()
		}
		f := strings.Fields(line)
		if len(f) != 2 || (f[1] != "sshd" && f[1] != "sshd-session") {
			continue
		}
		candidates++
		if candidates > 256 {
			state = core.SourceStatus{State: "partial", Detail: "SSH inventory exceeded 256 processes"}
			break
		}
		pid, e := strconv.Atoi(f[0])
		if e != nil {
			continue
		}
		v, e := s.identity(pid, string(boot))
		if e == nil {
			result = append(result, v)
		} else if errors.Is(e, os.ErrPermission) {
			state = core.SourceStatus{State: "partial", Detail: "Some SSH processes are hidden by host permissions"}
		}
	}
	// utmp only enriches verified process candidates; local logins and stale records never create SSH sessions.
	who, e := run(ctx, "/usr/bin/who", "-u")
	if e == nil {
		enrichWho(result, who)
	}
	// logind adds reliable remote origins even when modern OpenSSH does not write utmp.
	for i := range result {
		v := &result[i]
		if v.LoginID == "" {
			continue
		}
		text, err := run(ctx, "/usr/bin/loginctl", "show-session", v.LoginID, "--property=Remote,RemoteHost,Name,TTY,State,Timestamp")
		if err != nil {
			continue
		}
		p := core.Properties(text)
		if p["Remote"] == "yes" && p["Name"] == v.User && p["State"] != "closing" {
			if v.From == "" {
				v.From = p["RemoteHost"]
			}
			if v.Since == "" {
				v.Since = p["Timestamp"]
				v.SinceSource = "logind"
			}
		}
	}
	if len(result) > 0 {
		if sockets, err := run(ctx, "/usr/bin/ss", "-H", "-ntp", "state", "established"); err == nil {
			enrichPeers(result, sockets)
		}
	}
	if ctx.Err() != nil {
		return result, core.Status(ctx.Err()), ctx.Err()
	}
	sort.Slice(result, func(i, j int) bool { return result[i].PID < result[j].PID })
	return result, state, nil
}
func enrichWho(sessions []core.Session, text string) {
	for _, line := range strings.Split(text, "\n") {
		f := strings.Fields(line)
		if len(f) < 6 {
			continue
		}
		pid, e := strconv.Atoi(f[5])
		if e != nil {
			continue
		}
		for i := range sessions {
			v := &sessions[i]
			if v.User != f[0] || v.Terminal != f[1] || v.PID != pid {
				continue
			}
			v.Since = f[2] + " " + f[3]
			v.SinceSource = "utmp"
			if n := strings.LastIndex(line, "("); n >= 0 && strings.HasSuffix(strings.TrimSpace(line), ")") {
				v.From = strings.TrimSuffix(strings.TrimSpace(line[n+1:]), ")")
			}
		}
	}
}
func (s *Source) Signal(ctx context.Context, session core.Session) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if protected(session.PID) {
		return core.ErrPermission
	}
	fd, e := unix.PidfdOpen(session.PID, 0)
	if e != nil {
		return signalError(e)
	}
	defer unix.Close(fd)
	boot, e := readSmall("/proc/sys/kernel/random/boot_id")
	if e != nil {
		return signalError(e)
	}
	fresh, e := s.identity(session.PID, string(boot))
	if e != nil {
		return signalError(e)
	}
	if fresh.ID != session.ID || fresh.StartTicks != session.StartTicks {
		return core.ErrConflict
	}
	if !fresh.Verified || !fresh.CanTerminate {
		return core.ErrPermission
	}
	// pidfd binds this signal to the inspected process, even if the numeric PID is reused.
	if e := unix.PidfdSendSignal(fd, unix.SIGTERM, nil, 0); e != nil {
		return fmt.Errorf("signal verified SSH session: %w", signalError(e))
	}
	return nil
}

var socketPID = regexp.MustCompile(`pid=([0-9]+),`)

func enrichPeers(sessions []core.Session, text string) {
	for _, line := range strings.Split(text, "\n") {
		f := strings.Fields(line)
		if len(f) < 5 {
			continue
		}
		for _, match := range socketPID.FindAllStringSubmatch(strings.Join(f[4:], " "), -1) {
			pid, _ := strconv.Atoi(match[1])
			for i := range sessions {
				if sessions[i].PID == pid && sessions[i].From == "" {
					sessions[i].From = f[3]
				}
			}
		}
	}
}

func signalError(err error) error {
	switch {
	case errors.Is(err, unix.ESRCH), errors.Is(err, os.ErrNotExist):
		return core.ErrNotFound
	case errors.Is(err, unix.EPERM), errors.Is(err, os.ErrPermission):
		return core.ErrPermission
	case errors.Is(err, unix.ENOSYS):
		return core.ErrUnsupported
	default:
		return err
	}
}
