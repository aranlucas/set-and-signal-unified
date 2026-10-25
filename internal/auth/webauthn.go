// Package auth hosts the passkey (WebAuthn) flows ported from api/server.js
// §"register/verify" and §"login/verify" (lines 291–455): challenge payloads in
// the challenges table keyed by a random cid with a 5-minute TTL, registration
// options residentKey=required / userVerification=preferred / attestation=none,
// discoverable login with an empty allowCredentials list, counter updates, and
// last-moment invite re-check/burn.
package auth

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json/v2"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	webauthn "github.com/go-webauthn/webauthn/webauthn"

	"github.com/aranlucas/set-and-signal-unified/internal/config"
	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

// Flow errors mapped to HTTP-ish outcomes by callers.
var (
	// ErrChallengeExpired mirrors upstream's 400 "challenge expired — try again".
	ErrChallengeExpired = errors.New("webauthn: challenge expired")
	// ErrInvalidName mirrors upstream's 400 "name required".
	ErrInvalidName = errors.New("webauthn: name required")
	// ErrInviteRequired mirrors upstream's 403 "a valid invite code is required".
	ErrInviteRequired = errors.New("webauthn: a valid invite code is required")
	// ErrUnknownCredential mirrors upstream's 404 "unknown passkey".
	ErrUnknownCredential = errors.New("webauthn: unknown passkey")
	// ErrAccountDisabled mirrors upstream's 403 "this account has been disabled".
	ErrAccountDisabled = errors.New("webauthn: this account has been disabled")
)

// VerificationError marks a failure attributable to the credential payload
// the client sent — go-webauthn's parse/verify calls. Upstream answers these
// with 400 'verification failed: <message>'; any other error escaping a
// Finish* call is an unexpected server fault (500).
type VerificationError struct{ Err error }

func (e *VerificationError) Error() string { return e.Err.Error() }
func (e *VerificationError) Unwrap() error { return e.Err }

const (
	challengeTTL = 5 * time.Minute // upstream putChallenge lifetime
	maxNameRunes = 40              // upstream trims names to 40 characters
)

// WebAuthn wraps go-webauthn with the store-backed challenge table and instance config.
type WebAuthn struct {
	*webauthn.WebAuthn
	ST  *store.Store
	Cfg config.Config
}

// New validates the relying-party config and returns the flow wrapper.
func New(st *store.Store, cfg config.Config) (*WebAuthn, error) {
	w, err := webauthn.New(&webauthn.Config{
		RPID:          cfg.RPID,
		RPDisplayName: cfg.RPName,
		RPOrigins:     []string{cfg.Origin},
		// Upstream generateRegistrationOptions: attestationType 'none',
		// authenticatorSelection {residentKey required, userVerification preferred}.
		AttestationPreference: protocol.PreferNoAttestation,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:        protocol.ResidentKeyRequirementRequired,
			RequireResidentKey: protocol.ResidentKeyRequired(),
			UserVerification:   protocol.VerificationPreferred,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("webauthn: config: %w", err)
	}
	return &WebAuthn{WebAuthn: w, ST: st, Cfg: cfg}, nil
}

// waUser adapts store rows to go-webauthn's User interface. ID is the raw user
// handle (the ASCII uid, matching upstream's Buffer.from(uid)).
type waUser struct {
	id    []byte
	name  string
	creds []webauthn.Credential
}

func (u *waUser) WebAuthnID() []byte                         { return u.id }
func (u *waUser) WebAuthnName() string                       { return u.name }
func (u *waUser) WebAuthnDisplayName() string                { return u.name }
func (u *waUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

// challengePayload is what the challenges row holds between Begin and Finish.
type challengePayload struct {
	Challenge string `json:"challenge"` // b64url, echoed by the client
	Name      string `json:"name,omitempty"`
	UID       string `json:"uid,omitempty"`
	Code      string `json:"code,omitempty"`
}

func newCID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("webauthn: cid randomness: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// putChallenge stores the payload under a fresh random cid with the shared TTL.
func (w *WebAuthn) putChallenge(p challengePayload) (cid string, err error) {
	cid, err = newCID()
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return "", fmt.Errorf("webauthn: encode challenge payload: %w", err)
	}
	if err := w.ST.PutChallenge(cid, raw, time.Now().Add(challengeTTL).Unix()); err != nil {
		return "", err
	}
	return cid, nil
}

// takeChallenge consumes the single-use challenge; nil-equivalent when absent
// or expired (delete-first semantics live in the store).
func (w *WebAuthn) takeChallenge(cid string) (*challengePayload, error) {
	raw, err := w.ST.TakeChallenge(cid)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, ErrChallengeExpired
	}
	var p challengePayload
	if err := json.Unmarshal(raw, &p); err != nil || p.Challenge == "" {
		return nil, fmt.Errorf("webauthn: corrupt challenge payload: %w", err)
	}
	return &p, nil
}

// inviteValid reports whether code is unused and unrevoked.
func (w *WebAuthn) inviteValid(code string) bool {
	invites, err := w.ST.Invites()
	if err != nil {
		return false
	}
	for _, i := range invites {
		if i.Code == code && i.UsedBy == "" && !i.Revoked {
			return true
		}
	}
	return false
}

// BeginRegistration validates the profile name and invite gate, mints the new
// user id, and returns (cid, CredentialCreation options) for the browser.
func (w *WebAuthn) BeginRegistration(name, inviteCode string) (cid string, opts *protocol.CredentialCreation, err error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", nil, ErrInvalidName
	}
	runeName := []rune(name)
	if len(runeName) > maxNameRunes {
		name = string(runeName[:maxNameRunes])
	}

	code := strings.ToUpper(strings.TrimSpace(inviteCode))
	if w.Cfg.InviteOnly {
		if !w.inviteValid(code) {
			return "", nil, ErrInviteRequired
		}
	} else {
		code = ""
	}

	uidB := make([]byte, 12)
	if _, err := rand.Read(uidB); err != nil {
		return "", nil, fmt.Errorf("webauthn: uid randomness: %w", err)
	}
	uid := base64.RawURLEncoding.EncodeToString(uidB)

	user := &waUser{id: []byte(uid), name: name}
	creation, session, err := w.WebAuthn.BeginRegistration(user)
	if err != nil {
		return "", nil, fmt.Errorf("webauthn: begin registration: %w", err)
	}

	cid, err = w.putChallenge(challengePayload{Challenge: session.Challenge, Name: name, UID: uid, Code: code})
	if err != nil {
		return "", nil, err
	}
	return cid, creation, nil
}

// FinishRegistration verifies the attestation response against the stored
// challenge, rejects duplicate credential ids, re-checks and burns the invite,
// and creates the user + first credential atomically.
func (w *WebAuthn) FinishRegistration(cid string, credJSON []byte) (user store.User, err error) {
	payload, err := w.takeChallenge(cid)
	if err != nil {
		return store.User{}, err
	}
	// Upstream rejects `!c.uid` with challenge-expired BEFORE verification —
	// a login challenge must never mint a registration (it would bypass the
	// invite burn in INVITE_ONLY deployments).
	if payload.UID == "" {
		return store.User{}, ErrChallengeExpired
	}

	parsed, err := protocol.ParseCredentialCreationResponseBody(bytes.NewReader(credJSON))
	if err != nil {
		return store.User{}, &VerificationError{fmt.Errorf("webauthn: parse registration response: %w", err)}
	}

	session := webauthn.SessionData{
		Challenge:        payload.Challenge,
		UserID:           []byte(payload.UID),
		CredParams:       webauthn.CredentialParametersDefault(),
		UserVerification: protocol.VerificationPreferred,
	}
	regUser := &waUser{id: []byte(payload.UID), name: payload.Name}
	credential, err := w.CreateCredential(regUser, session, parsed)
	if err != nil {
		return store.User{}, &VerificationError{fmt.Errorf("webauthn: verification failed: %w", err)}
	}

	credID := base64.RawURLEncoding.EncodeToString(credential.ID)
	transports := ""
	if len(credential.Transport) > 0 {
		names := make([]string, len(credential.Transport))
		for i, t := range credential.Transport {
			names[i] = string(t)
		}
		b, _ := json.Marshal(names)
		transports = string(b)
	}

	reg := store.User{
		ID:      payload.UID,
		Name:    payload.Name,
		Created: time.Now().UTC().Format(time.RFC3339),
	}
	cred := store.Credential{
		ID:         credID,
		UserID:     payload.UID,
		PublicKey:  base64.RawURLEncoding.EncodeToString(credential.PublicKey),
		Counter:    int(credential.Authenticator.SignCount),
		Transports: transports,
	}
	inviteCode := ""
	if w.Cfg.InviteOnly {
		inviteCode = payload.Code
	}
	if err := w.ST.CompleteRegistration(reg, cred, inviteCode); err != nil {
		return store.User{}, err // ErrDuplicateCredential / ErrInviteNotValid pass through
	}
	if inviteCode != "" {
		reg.InvitedBy = inviteCode
	}
	return reg, nil
}

// BeginLogin issues discoverable-credential assertion options (allowCredentials
// empty — users sign in by picking their passkey).
func (w *WebAuthn) BeginLogin() (cid string, opts *protocol.CredentialAssertion, err error) {
	assertion, session, err := w.BeginDiscoverableLogin()
	if err != nil {
		return "", nil, fmt.Errorf("webauthn: begin login: %w", err)
	}
	cid, err = w.putChallenge(challengePayload{Challenge: session.Challenge})
	if err != nil {
		return "", nil, err
	}
	return cid, assertion, nil
}

// FinishLogin verifies the assertion for whichever stored credential signed it,
// rejects disabled accounts, and advances the signature counter.
func (w *WebAuthn) FinishLogin(cid string, credJSON []byte) (user store.User, err error) {
	payload, err := w.takeChallenge(cid)
	if err != nil {
		return store.User{}, err
	}

	parsed, err := protocol.ParseCredentialRequestResponseBody(bytes.NewReader(credJSON))
	if err != nil {
		return store.User{}, &VerificationError{fmt.Errorf("webauthn: parse assertion response: %w", err)}
	}

	credID := base64.RawURLEncoding.EncodeToString(parsed.RawID)
	cred, err := w.ST.CredentialByID(credID)
	if err != nil {
		return store.User{}, err
	}
	if cred == nil {
		return store.User{}, ErrUnknownCredential
	}

	u, err := w.ST.UserByID(cred.UserID)
	if err != nil {
		return store.User{}, err
	}
	if u == nil {
		return store.User{}, fmt.Errorf("webauthn: user %s missing for credential", cred.UserID)
	}

	publicKey, err := base64.RawURLEncoding.DecodeString(cred.PublicKey)
	if err != nil {
		return store.User{}, fmt.Errorf("webauthn: decode stored public key: %w", err)
	}
	stored := &waUser{
		id:   []byte(u.ID),
		name: u.Name,
		creds: []webauthn.Credential{{
			ID:            parsed.RawID,
			PublicKey:     publicKey,
			Authenticator: webauthn.Authenticator{SignCount: uint32(cred.Counter)},
		}},
	}

	handler := func(rawID, userHandle []byte) (webauthn.User, error) { return stored, nil }
	session := webauthn.SessionData{Challenge: payload.Challenge}
	credential, err := w.ValidateDiscoverableLogin(handler, session, parsed)
	if err != nil {
		return store.User{}, &VerificationError{fmt.Errorf("webauthn: verification failed: %w", err)}
	}

	// Counter persists BEFORE the disabled 403, matching upstream's write-then-
	// reject ordering (the signature was valid; the count is real).
	if err := w.ST.UpdateCredentialCounter(cred.ID, int(credential.Authenticator.SignCount)); err != nil {
		return store.User{}, err
	}

	if u.Disabled {
		return store.User{}, ErrAccountDisabled
	}
	return *u, nil
}
