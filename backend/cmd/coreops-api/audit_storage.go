package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"golang.org/x/sys/unix"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

const auditRotationBytes = 8 << 20
const auditArchives = 3

func auditDigest(e AuditEntry) string {
	e.Hash = ""
	data, _ := json.Marshal(e)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func secureAuditFile(path string, flags int) (*os.File, error) {
	fd, err := unix.Open(path, flags|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	owner, ok := st.Sys().(*syscall.Stat_t)
	if !st.Mode().IsRegular() || st.Mode().Perm() != 0600 || !ok || owner.Uid != uint32(os.Geteuid()) || owner.Nlink != 1 {
		f.Close()
		return nil, errors.New("unsafe audit file ownership or permissions")
	}
	return f, nil
}
func (l *AuditLog) fileLock() (func(), error) {
	f, err := secureAuditFile(filepath.Join(filepath.Dir(l.path), ".audit.lock"), unix.O_CREAT|unix.O_RDWR)
	if err != nil {
		return nil, err
	}
	if err = unix.Flock(int(f.Fd()), unix.LOCK_EX); err != nil {
		f.Close()
		return nil, err
	}
	return func() { _ = unix.Flock(int(f.Fd()), unix.LOCK_UN); f.Close() }, nil
}

type AuditIntegrity struct {
	State         string `json:"state"`
	Records       int    `json:"records"`
	LegacyRecords int    `json:"legacyRecords"`
	Files         int    `json:"files"`
	Retention     string `json:"retention"`
	Detail        string `json:"detail"`
	LastHash      string `json:"lastHash"`
	Sequence      uint64 `json:"sequence"`
}

func (l *AuditLog) verifyLocked() (AuditIntegrity, error) {
	result := AuditIntegrity{State: "valid", Retention: "Current file and three archives, 8 MiB each", Detail: "Local SHA-256 chain is consistent for retained records. This is not an external signature or protection against a compromised API account/root."}
	previous := ""
	var sequence uint64
	for archive := auditArchives; archive >= 0; archive-- {
		path := l.path
		if archive > 0 {
			path += "." + strconv.Itoa(archive)
		}
		f, err := secureAuditFile(path, unix.O_RDONLY)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return result, err
		}
		st, _ := f.Stat()
		limit := int64(auditRotationBytes + 16384)
		if l.maxBytes > 0 {
			limit = int64(l.maxBytes + 16384)
		}
		if st.Size() > limit {
			f.Close()
			return result, errors.New("audit file exceeds retention boundary")
		}
		result.Files++
		scanner := bufio.NewScanner(io.LimitReader(f, limit+1))
		scanner.Buffer(make([]byte, 4096), 16384)
		for scanner.Scan() {
			line := bytes.TrimSpace(scanner.Bytes())
			if len(line) == 0 {
				continue
			}
			var entry AuditEntry
			if json.Unmarshal(line, &entry) != nil {
				f.Close()
				return result, errors.New("invalid audit record")
			}
			result.Records++
			if entry.Hash == "" {
				if sequence > 0 {
					f.Close()
					return result, errors.New("legacy record interrupts audit chain")
				}
				result.LegacyRecords++
				sum := sha256.Sum256(line)
				previous = hex.EncodeToString(sum[:])
				continue
			}
			canonical, _ := json.Marshal(entry)
			if !bytes.Equal(line, canonical) || entry.Hash != auditDigest(entry) || entry.Sequence == 0 || (sequence > 0 && entry.Sequence != sequence+1) || (previous != "" && entry.PreviousHash != previous) {
				f.Close()
				return result, errors.New("audit hash chain mismatch")
			}
			previous = entry.Hash
			sequence = entry.Sequence
		}
		err = scanner.Err()
		f.Close()
		if err != nil {
			return result, err
		}
	}
	result.LastHash = previous
	result.Sequence = sequence
	if result.LegacyRecords > 0 {
		result.State = "legacy_partial"
		result.Detail += " Earlier legacy records are not hash-protected."
	}
	if result.Records == 0 {
		result.State = "empty"
	}
	return result, nil
}
func (l *AuditLog) lastRecord() (AuditEntry, error) {
	for index := 0; index <= auditArchives; index++ {
		path := l.path
		if index > 0 {
			path += "." + strconv.Itoa(index)
		}
		f, err := secureAuditFile(path, unix.O_RDONLY)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return AuditEntry{}, err
		}
		st, _ := f.Stat()
		if st.Size() == 0 {
			f.Close()
			continue
		}
		start := st.Size() - 16384
		if start < 0 {
			start = 0
		}
		if _, err = f.Seek(start, io.SeekStart); err != nil {
			f.Close()
			return AuditEntry{}, err
		}
		data, err := io.ReadAll(io.LimitReader(f, 16385))
		f.Close()
		if err != nil {
			return AuditEntry{}, err
		}
		line := strings.TrimSpace(string(data))
		if n := strings.LastIndexByte(line, '\n'); n >= 0 {
			line = line[n+1:]
		}
		var e AuditEntry
		if json.Unmarshal([]byte(line), &e) != nil {
			return e, errors.New("audit tail is invalid")
		}
		if e.Hash == "" {
			sum := sha256.Sum256([]byte(line))
			e.Hash = hex.EncodeToString(sum[:])
		} else if canonical, _ := json.Marshal(e); e.Hash != auditDigest(e) || string(canonical) != line {
			return e, errors.New("audit tail hash mismatch")
		}
		return e, nil
	}
	return AuditEntry{}, nil
}
func (l *AuditLog) rotate(next int) error {
	max := l.maxBytes
	if max == 0 {
		max = auditRotationBytes
	}
	st, err := os.Lstat(l.path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if st.Size() == 0 || st.Size()+int64(next) <= int64(max) {
		return nil
	}
	for i := auditArchives - 1; i >= 0; i-- {
		from := l.path
		if i > 0 {
			from += "." + strconv.Itoa(i)
		}
		to := l.path + "." + strconv.Itoa(i+1)
		if err = os.Rename(from, to); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
func (l *AuditLog) integrityHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	l.mu.Lock()
	defer l.mu.Unlock()
	unlock, err := l.fileLock()
	if err != nil {
		writeError(w, 503, errors.New("audit integrity is unavailable"))
		return
	}
	defer unlock()
	result, err := l.verifyLocked()
	if err != nil {
		writeError(w, 503, errors.New("audit integrity verification failed; review retained files before privileged actions"))
		return
	}
	writeJSON(w, 200, result)
}
