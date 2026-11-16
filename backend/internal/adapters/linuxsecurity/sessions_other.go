//go:build !linux

package linuxsecurity

import (
	"context"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"os"
)

func rootOwned(os.FileInfo) bool { return false }
func (s *Source) Sessions(context.Context) ([]core.Session, core.SourceStatus, error) {
	return []core.Session{}, core.SourceStatus{State: "unavailable", Detail: "SSH inventory requires Linux procfs"}, nil
}
func (s *Source) Signal(context.Context, core.Session) error { return core.ErrUnsupported }
