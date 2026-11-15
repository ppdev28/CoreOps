package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

// lockState serializes CLI/server access and reloads both files on every
// operation. The lock file is permanent: never unlink it while CoreOps runs.
// All cooperating processes must use this implementation.
func (s *AuthStore) lockState() (func(), error) {
	s.mu.Lock()
	file, err := os.OpenFile(filepath.Join(s.dir, ".identity.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	if err := unix.Flock(int(file.Fd()), unix.LOCK_EX); err != nil {
		file.Close()
		s.mu.Unlock()
		return nil, err
	}
	unlock := func() {
		_ = unix.Flock(int(file.Fd()), unix.LOCK_UN)
		_ = file.Close()
		s.mu.Unlock()
	}
	users := map[string]User{}
	sessions := map[string]session{}
	err = errors.Join(s.load(usersFileName, &users), s.load(sessionsFileName, &sessions))
	if err != nil || users == nil || sessions == nil {
		unlock()
		return nil, fmt.Errorf("read identity state: %w", errors.Join(err, errors.New("identity files must contain JSON objects")))
	}
	s.users, s.sessions = users, sessions
	return unlock, nil
}
