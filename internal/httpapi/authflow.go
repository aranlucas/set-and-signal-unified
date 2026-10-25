package httpapi

import (
	"encoding/json/jsontext"
	"errors"
	"net/http"
	"strings"

	"github.com/aranlucas/set-and-signal-unified/internal/auth"
	"github.com/aranlucas/set-and-signal-unified/internal/store"
	"github.com/go-webauthn/webauthn/protocol"
)

// cidCredential is the body shape of both verify endpoints: the challenge id
// returned by the options step plus the browser's credential response.
type cidCredential struct {
	CID        string         `json:"cid"`
	Credential jsontext.Value `json:"credential"`
}

// POST /api/register/options — validates name + invite gate, mints a
// registration challenge, returns {cid, options}.
func (s *Server) registerOptions(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
		Code string `json:"code"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	cid, opts, err := s.WA.BeginRegistration(body.Name, body.Code)
	switch {
	case err == nil:
	case errors.Is(err, auth.ErrInvalidName):
		writeErr(w, http.StatusBadRequest, "name required")
		return
	case errors.Is(err, auth.ErrInviteRequired):
		writeErr(w, http.StatusForbidden, "a valid invite code is required")
		return
	default:
		serverError(w)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		CID     string                       `json:"cid"`
		Options *protocol.CredentialCreation `json:"options"`
	}{CID: cid, Options: opts})
}

// POST /api/register/verify — verifies the attestation, creates user +
// first credential, mints the session cookie.
func (s *Server) registerVerify(w http.ResponseWriter, r *http.Request) {
	var body cidCredential
	if !readJSON(w, r, &body) {
		return
	}
	user, err := s.WA.FinishRegistration(body.CID, body.Credential)
	switch {
	case err == nil:
	case errors.Is(err, auth.ErrChallengeExpired):
		writeErr(w, http.StatusBadRequest, "challenge expired — try again")
		return
	case errors.Is(err, store.ErrDuplicateCredential):
		writeErr(w, http.StatusConflict, "credential already registered")
		return
	case errors.Is(err, store.ErrInviteNotValid):
		writeErr(w, http.StatusForbidden, "invite code is no longer valid — ask for a new one")
		return
	default:
		if _, ok := errors.AsType[*auth.VerificationError](err); ok {
			writeErr(w, http.StatusBadRequest, "verification failed: "+waMsg(err))
		} else {
			serverError(w) // store/DB faults are not client verification errors
		}
		return
	}
	w.Header().Add("Set-Cookie", s.setCookie(&user))
	writeJSON(w, http.StatusOK, userResponse{User: s.userPayload(user)})
}

// POST /api/login/options — discoverable-credential assertion options.
func (s *Server) loginOptions(w http.ResponseWriter, _ *http.Request) {
	cid, opts, err := s.WA.BeginLogin()
	if err != nil {
		serverError(w)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		CID     string                        `json:"cid"`
		Options *protocol.CredentialAssertion `json:"options"`
	}{CID: cid, Options: opts})
}

// POST /api/login/verify — verifies the assertion for whichever stored
// credential signed it and mints the session cookie.
func (s *Server) loginVerify(w http.ResponseWriter, r *http.Request) {
	var body cidCredential
	if !readJSON(w, r, &body) {
		return
	}
	user, err := s.WA.FinishLogin(body.CID, body.Credential)
	switch {
	case err == nil:
	case errors.Is(err, auth.ErrChallengeExpired):
		writeErr(w, http.StatusBadRequest, "challenge expired — try again")
		return
	case errors.Is(err, auth.ErrUnknownCredential):
		writeErr(w, http.StatusNotFound, "unknown passkey — create a profile first")
		return
	case errors.Is(err, auth.ErrAccountDisabled):
		writeErr(w, http.StatusForbidden, "this account has been disabled")
		return
	default:
		if _, ok := errors.AsType[*auth.VerificationError](err); ok {
			writeErr(w, http.StatusBadRequest, "verification failed: "+waMsg(err))
		} else {
			serverError(w) // store/DB faults are not client verification errors
		}
		return
	}
	w.Header().Add("Set-Cookie", s.setCookie(&user))
	writeJSON(w, http.StatusOK, userResponse{User: s.userPayload(user)})
}

// waMsg strips internal prefixes so the client sees the underlying error
// text, mirroring upstream's `'verification failed: ' + e.message`.
func waMsg(err error) string {
	msg := err.Error()
	for _, p := range []string{
		"webauthn: verification failed: ",
		"webauthn: parse registration response: ",
		"webauthn: parse assertion response: ",
	} {
		msg = strings.TrimPrefix(msg, p)
	}
	return msg
}

// POST /api/logout — clears the caller's cookie; no session required.
func (s *Server) logout(w http.ResponseWriter, _ *http.Request) {
	w.Header().Add("Set-Cookie", s.clearCookie())
	writeJSON(w, http.StatusOK, okResponse{OK: true})
}

// POST /api/logout/all — bumps the account's session version, invalidating
// every cookie ever issued for it; passkeys are untouched. Cookie-only.
func (s *Server) logoutAll(w http.ResponseWriter, r *http.Request) {
	u := s.requireSession(w, r)
	if u == nil {
		return
	}
	if _, err := s.ST.BumpSessionVersion(u.ID); err != nil {
		serverError(w)
		return
	}
	w.Header().Add("Set-Cookie", s.clearCookie())
	writeJSON(w, http.StatusOK, okResponse{OK: true})
}
