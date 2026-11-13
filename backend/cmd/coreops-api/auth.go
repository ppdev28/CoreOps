package main

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Role string

const (
	RoleViewer   Role = "viewer"
	RoleOperator Role = "operator"
	RoleAdmin    Role = "admin"
)

func (r Role) rank() int {
	switch r {
	case RoleViewer:
		return 1
	case RoleOperator:
		return 2
	case RoleAdmin:
		return 3
	}
	return 0
}

func parseRole(value string) (Role, bool) {
	role := Role(strings.ToLower(strings.TrimSpace(value)))
	return role, role.rank() > 0
}

const (
	pbkdf2Iterations   = 600_000
	minPasswordLength  = 10
	maxLoginFailures   = 5
	loginLockout       = 15 * time.Minute
	defaultSessionTTL  = 12 * time.Hour
	maxLoginBodyBytes  = 4 * 1024
	usersFileName      = "users.json"
	sessionsFileName   = "sessions.json"
	sessionTokenLength = 32
)

var (
	errInvalidCredentials = errors.New("invalid username or password")
	errTooManyAttempts    = errors.New("too many failed attempts, try again later")
)

type User struct {
	Name         string    `json:"name"`
	Role         Role      `json:"role"`
	PasswordHash string    `json:"passwordHash,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

// PublicUser is the user shape exposed through the API (never the hash).
type PublicUser struct {
	Name string `json:"name"`
	Role Role   `json:"role"`
}

func (u User) public() PublicUser { return PublicUser{Name: u.Name, Role: u.Role} }

type session struct {
	User    string    `json:"user"`
	Expires time.Time `json:"expires"`
}

type loginFailures struct {
	count int
	until time.Time
}

// AuthStore keeps users and sessions in small JSON files under the data
// directory. Session tokens are stored only as SHA-256 hashes.
type AuthStore struct {
	mu       sync.Mutex
	dir      string
	ttl      time.Duration
	now      func() time.Time
	users    map[string]User
	sessions map[string]session
	failures map[string]*loginFailures
}

func NewAuthStore(dir string, ttl time.Duration) (*AuthStore, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &AuthStore{
		dir:      dir,
		ttl:      ttl,
		now:      time.Now,
		users:    map[string]User{},
		sessions: map[string]session{},
		failures: map[string]*loginFailures{},
	}
	if err := s.load(usersFileName, &s.users); err != nil {
		return nil, fmt.Errorf("load users: %w", err)
	}
	if err := s.load(sessionsFileName, &s.sessions); err != nil {
		return nil, fmt.Errorf("load sessions: %w", err)
	}
	return s, nil
}

func (s *AuthStore) load(name string, dst any) error {
	data, err := os.ReadFile(filepath.Join(s.dir, name))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(data, dst)
}

// save writes atomically with owner-only permissions. Callers hold s.mu.
func (s *AuthStore) save(name string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(s.dir, name)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *AuthStore) HasUsers() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.users) > 0
}

func (s *AuthStore) ListUsers() []PublicUser {
	s.mu.Lock()
	defer s.mu.Unlock()
	users := make([]PublicUser, 0, len(s.users))
	for _, u := range s.users {
		users = append(users, u.public())
	}
	sort.Slice(users, func(i, j int) bool { return users[i].Name < users[j].Name })
	return users
}

func validatePassword(password string) error {
	if len(password) < minPasswordLength {
		return fmt.Errorf("password must be at least %d characters", minPasswordLength)
	}
	return nil
}

func (s *AuthStore) AddUser(name string, role Role, password string) error {
	if !validUserName(name) {
		return errors.New("user name must be 1-32 characters: letters, digits, '.', '_' or '-'")
	}
	if role.rank() == 0 {
		return errors.New("role must be viewer, operator or admin")
	}
	if err := validatePassword(password); err != nil {
		return err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.users[name]; exists {
		return fmt.Errorf("user %q already exists", name)
	}
	s.users[name] = User{Name: name, Role: role, PasswordHash: hash, CreatedAt: s.now().UTC()}
	return s.save(usersFileName, s.users)
}

func (s *AuthStore) SetPassword(name, password string) error {
	if err := validatePassword(password); err != nil {
		return err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[name]
	if !ok {
		return fmt.Errorf("user %q not found", name)
	}
	user.PasswordHash = hash
	s.users[name] = user
	s.dropSessionsLocked(name)
	if err := s.save(usersFileName, s.users); err != nil {
		return err
	}
	return s.save(sessionsFileName, s.sessions)
}

func (s *AuthStore) RemoveUser(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[name]; !ok {
		return fmt.Errorf("user %q not found", name)
	}
	delete(s.users, name)
	s.dropSessionsLocked(name)
	if err := s.save(usersFileName, s.users); err != nil {
		return err
	}
	return s.save(sessionsFileName, s.sessions)
}

func (s *AuthStore) dropSessionsLocked(user string) {
	for key, sess := range s.sessions {
		if sess.User == user {
			delete(s.sessions, key)
		}
	}
}

// dummyHash is verified when the user does not exist so that response time
// does not reveal which user names are valid.
var dummyHash, _ = hashPassword("coreops-dummy-password")

// Login verifies credentials and returns a new session token.
func (s *AuthStore) Login(name, password, remote string) (string, time.Time, User, error) {
	key := remote + "|" + strings.ToLower(name)
	s.mu.Lock()
	if f := s.failures[key]; f != nil && s.now().Before(f.until) {
		s.mu.Unlock()
		return "", time.Time{}, User{}, errTooManyAttempts
	}
	user, ok := s.users[name]
	s.mu.Unlock()

	hash := dummyHash
	if ok {
		hash = user.PasswordHash
	}
	valid := verifyPassword(password, hash)

	s.mu.Lock()
	defer s.mu.Unlock()
	if !ok || !valid {
		f := s.failures[key]
		if f == nil {
			f = &loginFailures{}
			s.failures[key] = f
		}
		f.count++
		if f.count >= maxLoginFailures {
			f.count = 0
			f.until = s.now().Add(loginLockout)
		}
		return "", time.Time{}, User{}, errInvalidCredentials
	}
	delete(s.failures, key)

	raw := make([]byte, sessionTokenLength)
	if _, err := rand.Read(raw); err != nil {
		return "", time.Time{}, User{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	expires := s.now().Add(s.ttl).UTC()
	s.pruneLocked()
	s.sessions[tokenKey(token)] = session{User: name, Expires: expires}
	if err := s.save(sessionsFileName, s.sessions); err != nil {
		return "", time.Time{}, User{}, err
	}
	return token, expires, user, nil
}

func (s *AuthStore) pruneLocked() {
	now := s.now()
	for key, sess := range s.sessions {
		if now.After(sess.Expires) {
			delete(s.sessions, key)
		}
	}
	for key, f := range s.failures {
		if f.count == 0 && now.After(f.until) {
			delete(s.failures, key)
		}
	}
}

func (s *AuthStore) Authenticate(token string) (User, bool) {
	if token == "" {
		return User{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[tokenKey(token)]
	if !ok || s.now().After(sess.Expires) {
		return User{}, false
	}
	user, ok := s.users[sess.User]
	return user, ok
}

func (s *AuthStore) Logout(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, tokenKey(token))
	_ = s.save(sessionsFileName, s.sessions)
}

func tokenKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func validUserName(name string) bool {
	if name == "" || len(name) > 32 {
		return false
	}
	for _, c := range name {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '.', c == '_', c == '-':
		default:
			return false
		}
	}
	return true
}

// Password hashes use the format pbkdf2-sha256$iterations$salt$hash.
func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, pbkdf2Iterations, 32)
	if err != nil {
		return "", err
	}
	enc := base64.RawStdEncoding
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", pbkdf2Iterations, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil || iterations < 1 {
		return false
	}
	enc := base64.RawStdEncoding
	salt, err := enc.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := enc.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, iterations, len(want))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

type ctxKey int

const (
	userCtxKey ctxKey = iota
	auditCtxKey
)

func userFromContext(ctx context.Context) (User, bool) {
	user, ok := ctx.Value(userCtxKey).(User)
	return user, ok
}

func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if len(header) > 7 && strings.EqualFold(header[:7], "bearer ") {
		return strings.TrimSpace(header[7:])
	}
	return ""
}

func remoteHost(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// require wraps a handler so only authenticated users with at least min role
// can reach it.
func (s *AuthStore) require(min Role, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.Authenticate(bearerToken(r))
		if !ok {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeJSON(w, http.StatusUnauthorized, ErrorResponse{Error: "authentication required"})
			return
		}
		if entry, ok := r.Context().Value(auditCtxKey).(*auditEntry); ok {
			entry.User, entry.Role = user.Name, user.Role
		}
		if user.Role.rank() < min.rank() {
			writeJSON(w, http.StatusForbidden, ErrorResponse{Error: "your role does not allow this action"})
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), userCtxKey, user)))
	}
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token     string     `json:"token"`
	ExpiresAt time.Time  `json:"expiresAt"`
	User      PublicUser `json:"user"`
}

func (s *AuthStore) loginHandler(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxLoginBodyBytes)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid login request"})
		return
	}
	if entry, ok := r.Context().Value(auditCtxKey).(*auditEntry); ok {
		entry.User = req.Username
		entry.Detail = "login"
	}
	token, expires, user, err := s.Login(req.Username, req.Password, remoteHost(r))
	switch {
	case errors.Is(err, errTooManyAttempts):
		writeJSON(w, http.StatusTooManyRequests, ErrorResponse{Error: err.Error()})
	case errors.Is(err, errInvalidCredentials):
		writeJSON(w, http.StatusUnauthorized, ErrorResponse{Error: err.Error()})
	case err != nil:
		writeJSON(w, http.StatusInternalServerError, ErrorResponse{Error: "could not create session"})
	default:
		if entry, ok := r.Context().Value(auditCtxKey).(*auditEntry); ok {
			entry.Role = user.Role
		}
		writeJSON(w, http.StatusOK, loginResponse{Token: token, ExpiresAt: expires, User: user.public()})
	}
}

func (s *AuthStore) logoutHandler(w http.ResponseWriter, r *http.Request) {
	s.Logout(bearerToken(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func meHandler(w http.ResponseWriter, r *http.Request) {
	user, _ := userFromContext(r.Context())
	writeJSON(w, http.StatusOK, user.public())
}

func contextWithAudit(r *http.Request, entry *auditEntry) context.Context {
	return context.WithValue(r.Context(), auditCtxKey, entry)
}
