// Package sysstat reads the host's existing sar archives; it never installs or
// enables collectors and never substitutes session measurements for history.
package sysstat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"sync"
	"syscall"
	"time"

	"github.com/ppdev28/CoreOps/backend/internal/monitoring"
)

const maxOutput = 4 * 1024 * 1024

var archiveName = regexp.MustCompile(`^sa([0-9]{2}|[0-9]{8})$`)

type cachedArchive struct {
	size     int64
	modified time.Time
	inode    uint64
	samples  []monitoring.HistoryPoint
}
type Reader struct {
	Directory string
	command   string
	slots     chan struct{}
	mu        sync.Mutex
	cache     map[string]cachedArchive
}

func NewReader(dir string) *Reader {
	cmd, _ := exec.LookPath("sadf")
	return &Reader{Directory: dir, command: cmd, slots: make(chan struct{}, 2), cache: map[string]cachedArchive{}}
}
func unavailable() error {
	return fmt.Errorf("%w: install/configure sysstat and allow the CoreOps service to read its sa archives", monitoring.ErrUnavailable)
}
func (r *Reader) Read(ctx context.Context, from, to time.Time) (monitoring.Archive, error) {
	out := monitoring.Archive{Samples: []monitoring.HistoryPoint{}, Warnings: []string{}}
	if r.command == "" {
		return out, unavailable()
	}
	root, e := os.OpenRoot(r.Directory)
	if e != nil {
		return out, unavailable()
	}
	defer root.Close()
	dir, e := root.Open(".")
	if e != nil {
		return out, unavailable()
	}
	entries, e := dir.ReadDir(4096)
	dir.Close()
	if e != nil && e != io.EOF {
		return out, unavailable()
	}
	if len(entries) == 4096 {
		return out, fmt.Errorf("%w: too many archive directory entries", monitoring.ErrUnavailable)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	files, readable := 0, 0
	for _, entry := range entries {
		if !archiveName.MatchString(entry.Name()) || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		info, e := root.Lstat(entry.Name())
		if e != nil || !info.Mode().IsRegular() {
			continue
		}
		// A daily archive cannot contain newer samples than its final write. Include
		// two extra days to account for UTC/local-day rollover, then filter timestamps.
		if info.ModTime().Before(from.Add(-48 * time.Hour)) {
			continue
		}
		files++
		if files > 64 {
			return out, fmt.Errorf("%w: too many retained archives", monitoring.ErrUnavailable)
		}
		f, e := root.OpenFile(entry.Name(), os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
		if e != nil {
			out.Warnings = append(out.Warnings, "A retained sysstat archive is not readable.")
			continue
		}
		samples, e := r.readFile(ctx, entry.Name(), f)
		f.Close()
		if e != nil {
			if ctx.Err() != nil {
				return out, ctx.Err()
			}
			out.Warnings = append(out.Warnings, "A sysstat archive could not be decoded; its interval is unavailable.")
			continue
		}
		readable++
		for _, p := range samples {
			if p.Time >= from.UnixMilli() && p.Time <= to.UnixMilli() {
				out.Samples = append(out.Samples, p)
			}
		}
		if len(out.Samples) > 10000 {
			return out, fmt.Errorf("%w: select a shorter range (more than 10000 archived samples)", monitoring.ErrUnavailable)
		}
	}
	if readable == 0 {
		return out, unavailable()
	}
	return out, nil
}
func (r *Reader) readFile(ctx context.Context, name string, f *os.File) ([]monitoring.HistoryPoint, error) {
	info, e := f.Stat()
	if e != nil || !info.Mode().IsRegular() || info.Size() > 64*1024*1024 {
		return nil, errors.New("invalid archive")
	}
	inode := uint64(0)
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		inode = st.Ino
	}
	r.mu.Lock()
	cached, ok := r.cache[name]
	r.mu.Unlock()
	if ok && cached.size == info.Size() && cached.modified.Equal(info.ModTime()) && cached.inode == inode {
		return cached.samples, nil
	}
	select {
	case r.slots <- struct{}{}:
		defer func() { <-r.slots }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	commandCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	// An inherited descriptor prevents archive replacement/symlink races between
	// validation and sadf opening it. No client-supplied paths or command options.
	cmd := exec.CommandContext(commandCtx, r.command, "-j", "/proc/self/fd/3", "--", "-u", "-r", "ALL")
	cmd.ExtraFiles = []*os.File{f}
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C", "TZ=UTC", "S_TIME_DEF_TIME=UTC"}
	var stdout limitedBuffer
	cmd.Stdout = &stdout
	cmd.Stderr = io.Discard
	if e = cmd.Run(); e != nil {
		return nil, errors.New("cannot decode sysstat archive")
	}
	samples, e := parse(stdout.Bytes())
	if e != nil {
		return nil, e
	}
	r.mu.Lock()
	count := len(samples)
	for _, v := range r.cache {
		count += len(v.samples)
	}
	if len(r.cache) >= 64 || count > 12000 {
		clear(r.cache)
	}
	r.cache[name] = cachedArchive{size: info.Size(), modified: info.ModTime(), inode: inode, samples: samples}
	r.mu.Unlock()
	return samples, nil
}

type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > maxOutput {
		return 0, errors.New("archive output too large")
	}
	return b.Buffer.Write(p)
}

type stamp struct {
	Date     string  `json:"date"`
	Time     string  `json:"time"`
	UTC      int     `json:"utc"`
	Interval float64 `json:"interval"`
}

func (s stamp) unix() (int64, error) {
	if s.UTC != 1 {
		return 0, errors.New("archive timestamp must be UTC")
	}
	t, e := time.Parse("2006-01-02T15:04:05", s.Date+"T"+s.Time)
	return t.UnixMilli(), e
}

type stat struct {
	Timestamp stamp `json:"timestamp"`
	CPU       []struct {
		CPU    string   `json:"cpu"`
		Idle   *float64 `json:"idle"`
		IOWait *float64 `json:"iowait"`
	} `json:"cpu-load"`
	Memory map[string]*float64 `json:"memory"`
}

func valid(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 }
func percent(v float64) *float64 {
	if !valid(v) || v > 100.05 {
		return nil
	}
	v = math.Min(v, 100)
	return &v
}
func parse(data []byte) ([]monitoring.HistoryPoint, error) {
	var doc struct {
		Sysstat struct {
			Hosts []struct {
				Statistics []stat `json:"statistics"`
				Restarts   []struct {
					Timestamp stamp `json:"timestamp"`
				} `json:"restarts"`
			} `json:"hosts"`
		} `json:"sysstat"`
	}
	if json.Unmarshal(data, &doc) != nil || len(doc.Sysstat.Hosts) != 1 {
		return nil, errors.New("invalid sysstat response")
	}
	host := doc.Sysstat.Hosts[0]
	out := []monitoring.HistoryPoint{}
	if len(host.Statistics) > 10000 {
		return nil, errors.New("too many archive samples")
	}
	for _, s := range host.Statistics {
		t, e := s.Timestamp.unix()
		if e != nil || s.Timestamp.Interval <= 0 {
			return nil, errors.New("invalid archive timestamp")
		}
		p := monitoring.HistoryPoint{Time: t, IntervalMS: int64(s.Timestamp.Interval * 1000)}
		for _, c := range s.CPU {
			if c.CPU == "all" && c.Idle != nil && c.IOWait != nil {
				v := 100 - *c.Idle - *c.IOWait
				if valid(*c.Idle) && *c.Idle <= 100 && valid(*c.IOWait) && *c.IOWait <= 100 && v >= -0.02 && v <= 100.02 {
					p.CPU = percent(math.Max(0, v))
				}
			}
		}
		// -r ALL exposes the components of historical MemTotal. This matches the
		// live CoreOps metric (MemTotal-MemAvailable), rather than sar's different
		// memused-percent definition. Missing components remain unavailable.
		total, complete := 0.0, true
		for _, key := range []string{"memfree", "memused", "buffers", "cached", "slab"} {
			v := s.Memory[key]
			if v == nil || !valid(*v) {
				complete = false
				break
			}
			total += *v
		}
		if avail := s.Memory["avail"]; complete && total > 0 && avail != nil && valid(*avail) && *avail <= total {
			p.Memory = percent((total - *avail) * 100 / total)
		}
		if p.CPU != nil || p.Memory != nil {
			out = append(out, p)
		}
	}
	for _, restart := range host.Restarts {
		if t, e := restart.Timestamp.unix(); e == nil {
			out = append(out, monitoring.HistoryPoint{Time: t})
		}
	}
	return out, nil
}
