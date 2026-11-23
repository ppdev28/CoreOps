package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"syscall"
	"time"
	"unicode"
	"unicode/utf8"
)

const terminalPasswordFile = "terminal-passwords.json"
const terminalPasswordKeyFile = ".terminal-passwords.key"

var terminalPasswordTarget = regexp.MustCompile(`^(host|container-[a-f0-9]{12,64})$`)
var errTerminalPasswordMissing = errors.New("no password is saved for this terminal target")

type terminalPasswordData struct {
	Version int               `json:"version"`
	Records map[string]string `json:"records"`
}

func validTerminalPassword(password string) bool {
	if len(password) == 0 || len(password) > 1024 || !utf8.ValidString(password) {
		return false
	}
	for _, r := range password {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			return false
		}
	}
	return true
}
func readPrivatePasswordFile(dir, name string, max int64) ([]byte, error) {
	f, err := os.OpenFile(filepath.Join(dir, name), os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || !ok || stat.Uid != uint32(os.Geteuid()) || info.Size() > max {
		return nil, errors.New("unsafe credential file")
	}
	data, err := io.ReadAll(io.LimitReader(f, max+1))
	if err != nil || int64(len(data)) > max {
		return nil, errors.New("credential file unavailable")
	}
	return data, nil
}
func passwordCipher(dir string, create bool) (cipher.AEAD, error) {
	key, err := readPrivatePasswordFile(dir, terminalPasswordKeyFile, 32)
	if errors.Is(err, os.ErrNotExist) && create {
		key = make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return nil, err
		}
		var f *os.File
		f, err = os.OpenFile(filepath.Join(dir, terminalPasswordKeyFile), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return nil, err
		}
		_, err = f.Write(key)
		if err == nil {
			err = f.Sync()
		}
		closeErr := f.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			return nil, err
		}
		parent, e := os.Open(dir)
		if e != nil {
			return nil, e
		}
		err = parent.Sync()
		parent.Close()
	}
	if err != nil || len(key) != 32 {
		return nil, errors.New("credential encryption key unavailable")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Sharing the identity lock with HTTP/CLI revalidates the live administrator
// before accessing a secret. Account incarnation + target authenticate ciphertext.
func (s *AuthStore) passwordOperation(token, target, action, password string) (bool, string, error) {
	if !terminalPasswordTarget.MatchString(target) {
		return false, "", errors.New("invalid terminal target")
	}
	unlock, err := s.lockState()
	if err != nil {
		return false, "", err
	}
	defer unlock()
	sess, ok := s.sessions[tokenKey(token)]
	user, exists := s.users[sess.User]
	if !ok || !exists || !s.now().Before(sess.Expires) || user.Role != RoleAdmin {
		return false, "", errUserCreationDenied
	}
	incarnation := user.CreatedAt.Format(time.RFC3339Nano)
	if user.CreatedAt.IsZero() {
		incarnation = user.PasswordHash
	}
	owner := user.Name + "\x00" + incarnation + "\x00" + target
	digest := sha256.Sum256([]byte(owner))
	recordID := hex.EncodeToString(digest[:])
	records := terminalPasswordData{Version: 1, Records: map[string]string{}}
	data, readErr := readPrivatePasswordFile(s.dir, terminalPasswordFile, 2<<20)
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return false, "", readErr
	}
	if readErr == nil && (json.Unmarshal(data, &records) != nil || records.Version != 1 || records.Records == nil || len(records.Records) > 512) {
		return false, "", errors.New("invalid credential storage")
	}
	saved := records.Records[recordID] != ""
	switch action {
	case "status":
		if len(records.Records) > 0 {
			if _, err = passwordCipher(s.dir, false); err != nil {
				return false, "", err
			}
		}
		return saved, "", nil
	case "delete":
		delete(records.Records, recordID)
		if saved {
			err = s.save(terminalPasswordFile, records)
		}
		return false, "", err
	case "save":
		if !validTerminalPassword(password) {
			return false, "", errors.New("invalid password")
		}
		if !saved && len(records.Records) >= 512 {
			return false, "", errors.New("credential storage limit reached")
		}
		aead, e := passwordCipher(s.dir, len(records.Records) == 0)
		if e != nil {
			return false, "", e
		}
		nonce := make([]byte, aead.NonceSize())
		if _, err = rand.Read(nonce); err != nil {
			return false, "", err
		}
		records.Records[recordID] = base64.StdEncoding.EncodeToString(aead.Seal(nonce, nonce, []byte(password), []byte(owner)))
		err = s.save(terminalPasswordFile, records)
		return err == nil, "", err
	case "reveal":
		if !saved {
			return false, "", errTerminalPasswordMissing
		}
		aead, e := passwordCipher(s.dir, false)
		if e != nil {
			return false, "", e
		}
		ciphertext, e := base64.StdEncoding.DecodeString(records.Records[recordID])
		if e != nil || len(ciphertext) < aead.NonceSize()+aead.Overhead()+1 || len(ciphertext) > 2048 {
			return false, "", errors.New("invalid encrypted password")
		}
		plain, e := aead.Open(nil, ciphertext[:aead.NonceSize()], ciphertext[aead.NonceSize():], []byte(owner))
		if e != nil || !validTerminalPassword(string(plain)) {
			return false, "", errors.New("password could not be decrypted")
		}
		return true, string(plain), nil
	}
	return false, "", errors.New("invalid password action")
}

// Protect direct paths and hard-link aliases from convenience Files operations.
// A privileged host shell still has the service account's filesystem authority.
func (f *FileExplorer) privateTerminalFile(relative string, info os.FileInfo) bool {
	if f.privateDir == "" {
		return false
	}
	for _, name := range []string{terminalPasswordFile, terminalPasswordKeyFile, "security-monitor.json", ".audit.lock", "audit.log.1", "audit.log.2", "audit.log.3"} {
		if info != nil {
			if live, err := os.Stat(filepath.Join(f.privateDir, name)); err == nil && os.SameFile(info, live) {
				return true
			}
		}
		if path.Base(relative) == name {
			parent, e := f.root.Stat(path.Dir(relative))
			private, e2 := os.Stat(f.privateDir)
			if e == nil && e2 == nil && os.SameFile(parent, private) {
				return true
			}
		}
	}
	return false
}
func (s *AuthStore) terminalPasswordHandler(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, private")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Referrer-Policy", "no-referrer")
		target := r.PathValue("target")
		if !terminalPasswordTarget.MatchString(target) || r.URL.RawQuery != "" {
			writeError(w, 400, errors.New("invalid terminal target"))
			return
		}
		password := ""
		if action == "save" {
			var input struct {
				Password string `json:"password"`
			}
			dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
			dec.DisallowUnknownFields()
			if dec.Decode(&input) != nil || dec.Decode(&struct{}{}) != io.EOF || !validTerminalPassword(input.Password) {
				writeError(w, 400, errors.New("use a password of 1–1024 bytes without line breaks or control characters"))
				return
			}
			password = input.Password
		} else {
			body, err := io.ReadAll(io.LimitReader(r.Body, 1))
			if err != nil || len(body) != 0 {
				writeError(w, 400, errors.New("this request must not contain a body"))
				return
			}
		}
		setAuditDetail(r, "terminal password "+action+" target="+target)
		saved, plain, err := s.passwordOperation(bearerToken(r), target, action, password)
		password = ""
		switch {
		case errors.Is(err, errUserCreationDenied):
			writeError(w, 403, errors.New("administrator session required"))
		case errors.Is(err, errTerminalPasswordMissing):
			writeError(w, 404, errTerminalPasswordMissing)
		case err != nil:
			writeError(w, 503, errors.New("encrypted terminal password storage is unavailable; verify storage permissions and key, then check saved status before retrying"))
		case action == "reveal":
			writeJSON(w, 200, map[string]string{"password": plain})
		default:
			writeJSON(w, 200, map[string]bool{"saved": saved})
		}
	}
}
