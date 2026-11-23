package linuxsecurity

import (
	"encoding/json"
	"errors"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path/filepath"
)

const CheckpointName = "security-monitor.json"

type CheckpointFile struct{ Dir string }

func (c CheckpointFile) Load() (core.Checkpoint, error) {
	var checkpoint core.Checkpoint
	fd, err := unix.Open(filepath.Join(c.Dir, CheckpointName), unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if errors.Is(err, os.ErrNotExist) {
		return checkpoint, nil
	}
	if err != nil {
		return checkpoint, err
	}
	f := os.NewFile(uintptr(fd), "checkpoint")
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return checkpoint, err
	}
	if !st.Mode().IsRegular() || st.Mode().Perm() != 0600 || st.Size() > 4096 {
		return checkpoint, errors.New("unsafe Security checkpoint")
	}
	data, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil {
		return checkpoint, err
	}
	if err = json.Unmarshal(data, &checkpoint); err != nil {
		return checkpoint, err
	}
	if checkpoint.Cursor != "" && !core.ValidEventQuery(core.EventQuery{Category: "all", Direction: "newer", Cursor: checkpoint.Cursor, Limit: 1}) {
		return checkpoint, errors.New("invalid checkpoint")
	}
	return checkpoint, nil
}
func (c CheckpointFile) Save(checkpoint core.Checkpoint) error {
	if _, err := c.Load(); err != nil {
		return err
	}
	data, err := json.Marshal(checkpoint)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(c.Dir, ".security-monitor-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	ce := f.Close()
	if err == nil {
		err = ce
	}
	if err != nil {
		return err
	}
	if err = os.Rename(name, filepath.Join(c.Dir, CheckpointName)); err != nil {
		return err
	}
	dir, err := os.Open(c.Dir)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
