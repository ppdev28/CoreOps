package containers

import (
	"context"
	"errors"
	"testing"
)

type terminalRuntimeStub struct {
	calls int
	ctx   context.Context
}

func (f *terminalRuntimeStub) CheckTerminal(ctx context.Context, id string) error {
	f.calls++
	f.ctx = ctx
	return ErrTerminalStopped
}
func (f *terminalRuntimeStub) OpenTerminal(ctx context.Context, id string, cols, rows uint16) (TerminalSession, error) {
	f.calls++
	f.ctx = ctx
	return nil, ErrTerminalStopped
}
func TestTerminalServiceValidatesBeforeRuntime(t *testing.T) {
	f := &terminalRuntimeStub{}
	s := NewTerminal(f)
	ctx := context.WithValue(context.Background(), struct{}{}, "test")
	for _, id := range []string{"name", "", "../abcdef123456"} {
		if err := s.Check(ctx, id); !errors.Is(err, ErrInvalidID) {
			t.Fatal(err)
		}
		if _, err := s.Open(ctx, id, 80, 24); !errors.Is(err, ErrInvalidID) {
			t.Fatal(err)
		}
	}
	for _, size := range [][2]uint16{{1, 24}, {501, 24}, {80, 0}, {80, 251}} {
		if _, err := s.Open(ctx, "abcdef123456", size[0], size[1]); !errors.Is(err, ErrInvalidID) {
			t.Fatal(err)
		}
	}
	if f.calls != 0 {
		t.Fatal("invalid target reached runtime")
	}
	if err := s.Check(ctx, "abcdef123456"); !errors.Is(err, ErrTerminalStopped) {
		t.Fatal(err)
	}
	if _, err := s.Open(ctx, "abcdef123456", 80, 24); !errors.Is(err, ErrTerminalStopped) {
		t.Fatal(err)
	}
	if f.calls != 2 || f.ctx != ctx {
		t.Fatal("runtime context/error contract changed")
	}
}
