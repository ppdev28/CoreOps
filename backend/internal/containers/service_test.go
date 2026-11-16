package containers

import (
	"context"
	"errors"
	"testing"
)

type fakeRuntime struct {
	calls    []string
	err      error
	received context.Context
}

func (r *fakeRuntime) List(ctx context.Context) ([]Summary, error) {
	r.received = ctx
	return nil, r.err
}
func (r *fakeRuntime) Inspect(ctx context.Context, id string) (Detail, error) {
	r.received = ctx
	return Detail{ID: id}, r.err
}
func (r *fakeRuntime) Start(ctx context.Context, id string) error   { return r.act(ctx, "start", id) }
func (r *fakeRuntime) Stop(ctx context.Context, id string) error    { return r.act(ctx, "stop", id) }
func (r *fakeRuntime) Restart(ctx context.Context, id string) error { return r.act(ctx, "restart", id) }
func (r *fakeRuntime) act(ctx context.Context, action, id string) error {
	r.received = ctx
	r.calls = append(r.calls, action+":"+id)
	return r.err
}
func TestActionsValidateBeforeCallingRuntime(t *testing.T) {
	runtime := &fakeRuntime{}
	service := New(runtime)
	for _, id := range []string{"", "abc", "../etc", "abcdef123456; rm -rf /", "zzzzzzzzzzzz"} {
		if err := service.Act(context.Background(), id, Start); !errors.Is(err, ErrInvalidID) {
			t.Fatalf("invalid id %q: %v", id, err)
		}
	}
	if err := service.Act(context.Background(), "abcdef123456", Action("delete")); !errors.Is(err, ErrInvalidAction) {
		t.Fatal(err)
	}
	if len(runtime.calls) != 0 {
		t.Fatal("invalid input reached the runtime")
	}
	for _, id := range []string{"abcdef123456", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"} {
		for _, action := range []Action{Start, Stop, Restart} {
			if err := service.Act(context.Background(), id, action); err != nil {
				t.Fatal(err)
			}
		}
	}
	if len(runtime.calls) != 6 {
		t.Fatal(runtime.calls)
	}
}
func TestErrorsAreNotRetriedAndContextIsPreserved(t *testing.T) {
	runtime := &fakeRuntime{err: ErrNotFound}
	service := New(runtime)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := service.Act(ctx, "abcdef123456", Restart); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if len(runtime.calls) != 1 || runtime.received != ctx {
		t.Fatal("context changed or action retried")
	}
	runtime.err = nil
	list, err := service.List(ctx)
	if err != nil || list == nil || len(list) != 0 {
		t.Fatalf("empty list: %v, %v", list, err)
	}
	detail, err := service.Inspect(ctx, "container-name")
	if err != nil || detail.ID != "container-name" || runtime.received != ctx {
		t.Fatal("inspect changed reference or context")
	}
}
