package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

func (s *AuthStore) usersHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	users, err := s.ListUsers()
	if err != nil {
		writeError(w, 503, errors.New("user storage is unavailable"))
		return
	}
	writeJSON(w, 200, users)
}
func (s *AuthStore) createUserHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var input struct {
		Name     string `json:"name"`
		Password string `json:"password"`
		Role     Role   `json:"role"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	dec.DisallowUnknownFields()
	if r.URL.RawQuery != "" || dec.Decode(&input) != nil || dec.Decode(&struct{}{}) != io.EOF {
		writeError(w, 400, errors.New("invalid user creation request"))
		return
	}
	if input.Role == "" {
		input.Role = RoleViewer
	}
	if !validUserName(input.Name) || input.Role.rank() == 0 || validatePassword(input.Password) != nil || len(input.Password) > 1024 {
		writeError(w, 400, errors.New("use a 1–32 character username (letters, digits, '.', '_' or '-'), a valid role and a 10–1024 byte password"))
		return
	}
	setAuditDetail(r, "create CoreOps user "+input.Name+" role="+string(input.Role))
	// Bound concurrent password hashing. The identity store still owns locking,
	// duplicate detection and persistence across HTTP and CLI processes.
	select {
	case userCreationSlots <- struct{}{}:
		defer func() { <-userCreationSlots }()
	default:
		writeError(w, 429, errors.New("user creation is busy; try again shortly"))
		return
	}
	if r.Context().Err() != nil {
		return
	}
	err := s.addUser(input.Name, input.Role, input.Password, tokenKey(bearerToken(r)))
	input.Password = ""
	if errors.Is(err, errUserCreationDenied) {
		writeError(w, 403, errUserCreationDenied)
		return
	}
	if errors.Is(err, errUserExists) {
		writeError(w, 409, errors.New("a user with this name already exists"))
		return
	}
	if err != nil {
		writeError(w, 503, errors.New("could not persist the user; refresh the list before retrying"))
		return
	}
	writeJSON(w, http.StatusCreated, PublicUser{Name: input.Name, Role: input.Role})
}

var userCreationSlots = make(chan struct{}, 2)
