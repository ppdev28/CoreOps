package main

import (
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestExtractedModuleDependencies(t *testing.T) {
	rules := []struct {
		folder    string
		forbidden []string
	}{
		{"../../internal/containers", []string{"net/http", "os/exec", "github.com/moby/", "/internal/adapters/", "/internal/transport/"}},
		{"../../internal/transport/httpapi", []string{"os/exec", "github.com/moby/", "/internal/adapters/"}},
	}
	for _, rule := range rules {
		files, err := filepath.Glob(filepath.Join(rule.folder, "*.go"))
		if err != nil {
			t.Fatal(err)
		}
		if len(files) == 0 {
			t.Fatalf("module %s disappeared", rule.folder)
		}
		for _, file := range files {
			if strings.HasSuffix(file, "_test.go") {
				continue
			}
			tree, err := parser.ParseFile(token.NewFileSet(), file, nil, parser.ImportsOnly)
			if err != nil {
				t.Fatal(err)
			}
			for _, item := range tree.Imports {
				name, err := strconv.Unquote(item.Path.Value)
				if err != nil {
					t.Fatal(err)
				}
				for _, blocked := range rule.forbidden {
					if name == blocked || strings.Contains(name, blocked) {
						t.Errorf("%s cannot import %s", file, name)
					}
				}
			}
		}
	}
}
