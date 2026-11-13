package main

import (
	"bufio"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"time"
)

const userUsage = `usage:
  coreops-api user add <name> <viewer|operator|admin>   read the password from stdin
  coreops-api user passwd <name>                        read the new password from stdin
  coreops-api user remove <name>
  coreops-api user list

Example: printf '%s' "$PASSWORD" | coreops-api user add alice admin
Users are stored in $COREOPS_DATA_DIR (default ./data).
`

// runUserCLI manages local users without needing the server to be running.
func runUserCLI(args []string) int {
	store, err := NewAuthStore(envString("COREOPS_DATA_DIR", "data"), defaultSessionTTL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	fail := func(err error) int {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	switch {
	case len(args) == 3 && args[0] == "add":
		role, ok := parseRole(args[2])
		if !ok {
			return fail(fmt.Errorf("role must be viewer, operator or admin"))
		}
		password, err := readPassword(os.Stdin)
		if err != nil {
			return fail(err)
		}
		if err := store.AddUser(args[1], role, password); err != nil {
			return fail(err)
		}
		fmt.Printf("user %s created with role %s\n", args[1], role)
	case len(args) == 2 && args[0] == "passwd":
		password, err := readPassword(os.Stdin)
		if err != nil {
			return fail(err)
		}
		if err := store.SetPassword(args[1], password); err != nil {
			return fail(err)
		}
		fmt.Printf("password updated for %s; existing sessions were revoked\n", args[1])
	case len(args) == 2 && args[0] == "remove":
		if err := store.RemoveUser(args[1]); err != nil {
			return fail(err)
		}
		fmt.Printf("user %s removed\n", args[1])
	case len(args) == 1 && args[0] == "list":
		for _, u := range store.ListUsers() {
			fmt.Printf("%s\t%s\n", u.Name, u.Role)
		}
	default:
		io.WriteString(os.Stderr, userUsage)
		return 2
	}
	return 0
}

func readPassword(in io.Reader) (string, error) {
	line, err := bufio.NewReader(in).ReadString('\n')
	if err != nil && err != io.EOF {
		return "", err
	}
	password := strings.TrimRight(line, "\r\n")
	if password == "" {
		return "", fmt.Errorf("no password received on stdin")
	}
	return password, nil
}

// bootstrapAdmin creates the first admin from COREOPS_ADMIN_USER and
// COREOPS_ADMIN_PASSWORD when no users exist yet.
func bootstrapAdmin(store *AuthStore, logger *slog.Logger) {
	if store.HasUsers() {
		return
	}
	name, password := os.Getenv("COREOPS_ADMIN_USER"), os.Getenv("COREOPS_ADMIN_PASSWORD")
	if name == "" || password == "" {
		logger.Warn("no users configured: every API call except health will be rejected; create one with `coreops-api user add <name> admin` or set COREOPS_ADMIN_USER and COREOPS_ADMIN_PASSWORD")
		return
	}
	if err := store.AddUser(name, RoleAdmin, password); err != nil {
		logger.Error("bootstrap admin user", "error", err)
		return
	}
	logger.Info("created initial admin user", "user", name)
}

func envDuration(name string, fallback time.Duration) time.Duration {
	if d, err := time.ParseDuration(envString(name, "")); err == nil && d > 0 {
		return d
	}
	return fallback
}
