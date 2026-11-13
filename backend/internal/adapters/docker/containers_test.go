package docker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/moby/moby/client"
	"github.com/ppdev28/CoreOps/backend/internal/containers"
)

// Exercise the real Moby client against a local HTTP fake, never a host socket.
func TestContainerAdapterWireCompatibility(t *testing.T) {
	var calls []string
	inspectJSON := `{"Id":"abcdef123456","Name":"/nginx","Created":"2026-11-01T00:00:00Z","State":{"Status":"running"},"Config":{"Image":"nginx:stable","Env":null,"Cmd":null,"Entrypoint":null,"WorkingDir":"","Labels":null},"HostConfig":{"RestartPolicy":{"Name":"unless-stopped"}},"Mounts":[{"Type":"bind","Source":"/srv/data","Destination":"/data","Mode":"rw","RW":true,"Propagation":"rprivate"}],"NetworkSettings":{"Networks":{"bridge":{"IPAddress":"172.17.0.2","Gateway":"172.17.0.1","NetworkID":"network-id","Aliases":["nginx"],"EndpointID":"endpoint-id"}},"Ports":{"80/tcp":[{"HostIp":"127.0.0.1","HostPort":"8080"}],"443/tcp":null}}}`
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/containers/json"):
			if r.URL.Query().Get("all") != "1" {
				t.Error("stopped containers excluded")
			}
			_, _ = io.WriteString(w, `[{"Id":"abcdef123456","Names":["/nginx"],"Image":"nginx:stable","State":"running","Status":"Up 1 day","Created":123,"Ports":[{"PrivatePort":80,"PublicPort":8080,"Type":"tcp","IP":"127.0.0.1"}],"NetworkSettings":{"Networks":{"bridge":{}}}}]`)
		case strings.HasSuffix(r.URL.Path, "/containers/missing/json"):
			w.WriteHeader(404)
			_, _ = io.WriteString(w, `{"message":"No such container: missing"}`)
		case strings.HasSuffix(r.URL.Path, "/containers/abcdef123456/json"):
			_, _ = io.WriteString(w, inspectJSON)
		case r.Method == http.MethodPost:
			w.WriteHeader(204)
		default:
			t.Errorf("unexpected engine request %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer engine.Close()
	sdk, err := client.NewClientWithOpts(client.WithHost(engine.URL), client.WithVersion("1.52"))
	if err != nil {
		t.Fatal(err)
	}
	defer sdk.Close()
	adapter := NewContainers(sdk)
	items, err := adapter.List(context.Background())
	if err != nil || len(items) != 1 {
		t.Fatalf("list: %+v %v", items, err)
	}
	if items[0].Name != "nginx" || items[0].Ports[0].PublicPort != 8080 || items[0].Networks[0] != "bridge" {
		t.Fatalf("mapping: %+v", items[0])
	}
	detail, err := adapter.Inspect(context.Background(), "abcdef123456")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Name != "nginx" || detail.Config.Cmd != nil || detail.Mounts[0]["Propagation"] != "rprivate" || detail.Networks["bridge"]["EndpointID"] != "endpoint-id" || detail.Ports["443/tcp"] != nil {
		t.Fatalf("inspect metadata changed: %+v", detail)
	}
	// All compatibility metadata is detached JSON, with no vendor structs inside.
	if _, ok := detail.Networks["bridge"]["Aliases"].([]any); !ok {
		t.Fatal("vendor metadata crossed the adapter boundary")
	}
	for _, action := range []func(context.Context, string) error{adapter.Start, adapter.Stop, adapter.Restart} {
		if err := action(context.Background(), "abcdef123456"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := adapter.Inspect(context.Background(), "missing"); !errors.Is(err, containers.ErrNotFound) {
		t.Fatalf("not found: %v", err)
	}
	if len(calls) != 6 {
		t.Fatal(calls)
	}
	serialized, err := json.Marshal(detail.Networks)
	if err != nil || !strings.Contains(string(serialized), "endpoint-id") {
		t.Fatal("lost inspect metadata")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := adapter.List(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal(fmt.Sprint("cancellation: ", err))
	}
}
