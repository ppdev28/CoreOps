package main

import (
    "bytes"
    "context"
    "fmt"
    "os"
    "os/exec"
    "path/filepath"
    "sort"
    "strings"
    "time"
)

type TerminalExecRequest struct {
    Command string `json:"command"`
    Cwd     string `json:"cwd,omitempty"`
}

type TerminalExecResponse struct {
    Output   string `json:"output"`
    ExitCode int    `json:"exitCode"`
    Cwd      string `json:"cwd"`
}

type TerminalCompleteRequest struct {
    Input string `json:"input"`
    Cwd   string `json:"cwd,omitempty"`
}

type TerminalCompleteResponse struct {
    Candidates []string `json:"candidates"`
}

const terminalCwdMarker = "__COREOPS_TERMINAL_CWD__"

func normalizeTerminalCwd(cwd string) (string, error) {
    cwd = strings.TrimSpace(cwd)
    if cwd == "" { cwd, _ = os.Getwd() }
    if !filepath.IsAbs(cwd) {
        base, _ := os.Getwd()
        cwd = filepath.Join(base, cwd)
    }
    cwd, err := filepath.Abs(cwd)
    if err != nil { return "", err }
    info, err := os.Stat(cwd)
    if err != nil || !info.IsDir() { return "", fmt.Errorf("bash: cd: %s: No such file or directory", cwd) }
    return cwd, nil
}

func executeTerminalCommand(parent context.Context, req TerminalExecRequest) (TerminalExecResponse, error) {
    cwd, err := normalizeTerminalCwd(req.Cwd)
    if err != nil { return TerminalExecResponse{Output: err.Error() + "\n", ExitCode: 1, Cwd: req.Cwd}, nil }

    ctx, cancel := context.WithTimeout(parent, 30*time.Second)
    defer cancel()

    // Each request still gets a fresh bash process, but the shell prints its final
    // working directory so commands such as `cd ..` persist in the web session.
    script := "set +e\n" + req.Command + "\nstatus=$?\nprintf '\\n" + terminalCwdMarker + "%s\\n' \"$PWD\"\nexit $status\n"
    cmd := exec.CommandContext(ctx, "bash", "-lc", script)
    cmd.Dir = cwd
    cmd.Env = os.Environ()
    var out bytes.Buffer
    cmd.Stdout, cmd.Stderr = &out, &out
    runErr := cmd.Run()

    exitCode := 0
    if runErr != nil {
        if exitErr, ok := runErr.(*exec.ExitError); ok { exitCode = exitErr.ExitCode() } else { exitCode = 124 }
    }

    raw := out.String()
    nextCwd := cwd
    if marker := strings.LastIndex(raw, "\n"+terminalCwdMarker); marker >= 0 {
        markerLine := strings.TrimSpace(raw[marker+1:])
        nextCwd = strings.TrimSpace(strings.TrimPrefix(markerLine, terminalCwdMarker))
        raw = strings.TrimSuffix(raw[:marker], "\n")
        if _, statErr := os.Stat(nextCwd); statErr != nil { nextCwd = cwd }
    }
    if ctx.Err() == context.DeadlineExceeded { raw += "\nbash: command timed out after 30s\n"; exitCode = 124 }
    return TerminalExecResponse{Output: raw, ExitCode: exitCode, Cwd: nextCwd}, nil
}

func completeTerminalInput(parent context.Context, req TerminalCompleteRequest) (TerminalCompleteResponse, error) {
    cwd, err := normalizeTerminalCwd(req.Cwd)
    if err != nil { return TerminalCompleteResponse{}, err }
    input := req.Input
    token := input
    if i := strings.LastIndexAny(input, " \t"); i >= 0 { token = input[i+1:] }
    token = strings.Trim(token, "\"'")
    if token == "" { return TerminalCompleteResponse{Candidates: []string{}}, nil }

    ctx, cancel := context.WithTimeout(parent, 2*time.Second)
    defer cancel()
    script := `prefix="$1"; compgen -c -- "$prefix"; compgen -f -- "$prefix"`
    cmd := exec.CommandContext(ctx, "bash", "-lc", script, "coreops-complete", token)
    cmd.Dir = cwd
    cmd.Env = os.Environ()
    var out bytes.Buffer
    cmd.Stdout = &out
    if err := cmd.Run(); err != nil && out.Len() == 0 { return TerminalCompleteResponse{Candidates: []string{}}, nil }

    seen := map[string]struct{}{}
    candidates := make([]string, 0)
    for _, line := range strings.Split(out.String(), "\n") {
        line = strings.TrimSpace(line)
        if line == "" { continue }
        if strings.Contains(line, "/") && !strings.HasPrefix(line, "/") && !strings.Contains(token, "/") { line = line + "/" }
        if _, ok := seen[line]; ok { continue }
        seen[line] = struct{}{}
        candidates = append(candidates, line)
    }
    sort.Strings(candidates)
    if len(candidates) > 100 { candidates = candidates[:100] }
    return TerminalCompleteResponse{Candidates: candidates}, nil
}
