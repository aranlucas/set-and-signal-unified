package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json/v2"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/protocol"

	"github.com/aranlucas/set-and-signal-unified/internal/config"
	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

// ---------- software authenticator ----------
//
// A minimal CTAP2-style ES256 authenticator producing real registration
// (attestation fmt "none") and assertion responses; verification runs through
// go-webauthn's real verify paths.

const (
	flagUserPresent            = 0x01
	flagUserVerified           = 0x04
	flagBackupEligible         = 0x08
	flagAttestedCredentialData = 0x40

	testRPID   = "localhost"
	testOrigin = "http://localhost:8080"
)

func cborByteString(b []byte) []byte {
	switch {
	case len(b) < 24:
		return append([]byte{0x40 | byte(len(b))}, b...)
	case len(b) < 256:
		return append([]byte{0x58, byte(len(b))}, b...)
	default:
		panic("test helper: long byte strings not needed")
	}
}

func cborTextString(s string) []byte {
	b := []byte(s)
	if len(b) >= 24 {
		panic("test helper: long text keys not needed")
	}
	return append([]byte{0x60 | byte(len(b))}, b...)
}

func b64u(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

type softAuthn struct {
	priv           *ecdsa.PrivateKey
	publicKeyBytes []byte
	credID         []byte
	signCount      uint32
}

func newSoftAuthn(t *testing.T) *softAuthn {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate authenticator key: %v", err)
	}
	publicKeyBytes, err := priv.PublicKey.Bytes()
	if err != nil {
		t.Fatalf("encode authenticator key: %v", err)
	}
	credID := make([]byte, 32)
	if _, err := rand.Read(credID); err != nil {
		t.Fatalf("generate credential id: %v", err)
	}
	return &softAuthn{priv: priv, publicKeyBytes: publicKeyBytes, credID: credID}
}

// coseKey serializes the EC2 (-7 / P-256) COSE_Key with hand-rolled canonical CBOR.
func (a *softAuthn) coseKey() []byte {
	encoded := a.publicKeyBytes
	x, y := encoded[1:33], encoded[33:]

	out := []byte{0xA5}           // map(5)
	out = append(out, 0x01, 0x02) // 1: 2 (EC2)
	out = append(out, 0x03, 0x26) // 3: -7 (ES256)
	out = append(out, 0x20, 0x01) // -1: 1 (P-256)
	out = append(out, 0x21)       // -2: x
	out = append(out, cborByteString(x)...)
	out = append(out, 0x22) // -3: y
	out = append(out, cborByteString(y)...)
	return out
}

// authData assembles the raw authenticator-data bytes.
func (a *softAuthn) authData(flags byte, attested bool) []byte {
	rpIDHash := sha256.Sum256([]byte(testRPID))
	out := append([]byte{}, rpIDHash[:]...)
	out = append(out, flags)
	var ctr [4]byte
	binary.BigEndian.PutUint32(ctr[:], a.signCount)
	out = append(out, ctr[:]...)

	if attested {
		out = append(out, make([]byte, 16)...) // zero AAGUID
		var l [2]byte
		binary.BigEndian.PutUint16(l[:], uint16(len(a.credID)))
		out = append(out, l[:]...)
		out = append(out, a.credID...)
		out = append(out, a.coseKey()...)
	}
	return out
}

func (a *softAuthn) clientData(typ, challenge string) []byte {
	b, _ := json.Marshal(struct {
		Type        string `json:"type"`
		Challenge   string `json:"challenge"`
		Origin      string `json:"origin"`
		CrossOrigin bool   `json:"crossOrigin"`
	}{Type: typ, Challenge: challenge, Origin: testOrigin})
	return b
}

// attestationObject builds the fmt=none attestation object around the auth data.
func (a *softAuthn) attestationObject(authData []byte) []byte {
	out := []byte{0xA3} // map(3)
	out = append(out, cborTextString("fmt")...)
	out = append(out, cborTextString("none")...)
	out = append(out, cborTextString("attStmt")...)
	out = append(out, 0xA0) // empty attStmt map
	out = append(out, cborTextString("authData")...)
	out = append(out, cborByteString(authData)...)
	return out
}

// registrationResponse for the given challenge; signCount should be 0.
func (a *softAuthn) registrationResponse(t *testing.T, challenge string) []byte {
	t.Helper()
	cd := a.clientData("webauthn.create", challenge)
	// No BackupEligible: the wrapper does not persist backup-flag state, so
	// go-webauthn's BE-consistency check requires flags we can reproduce.
	ad := a.authData(flagUserPresent|flagUserVerified|flagAttestedCredentialData, true)
	body := map[string]any{
		"id":    b64u(a.credID),
		"rawId": b64u(a.credID),
		"type":  "public-key",
		"response": map[string]any{
			"clientDataJSON":    b64u(cd),
			"attestationObject": b64u(a.attestationObject(ad)),
			"transports":        []string{"internal"},
		},
		"clientExtensionResults": map[string]any{},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal registration response: %v", err)
	}
	return raw
}

// assertionResponse signs authData || SHA-256(clientDataJSON) and bumps counter.
func (a *softAuthn) assertionResponse(t *testing.T, challenge string, userHandle []byte) []byte {
	t.Helper()
	a.signCount++

	cd := a.clientData("webauthn.get", challenge)
	cdHash := sha256.Sum256(cd)
	ad := a.authData(flagUserPresent|flagUserVerified, false)
	sigInput := append(append([]byte{}, ad...), cdHash[:]...)
	digest := sha256.Sum256(sigInput)
	sig, err := ecdsa.SignASN1(rand.Reader, a.priv, digest[:])
	if err != nil {
		t.Fatalf("sign assertion: %v", err)
	}

	body := map[string]any{
		"id":    b64u(a.credID),
		"rawId": b64u(a.credID),
		"type":  "public-key",
		"response": map[string]any{
			"clientDataJSON":    b64u(cd),
			"authenticatorData": b64u(ad),
			"signature":         b64u(sig),
			"userHandle":        b64u(userHandle),
		},
		"clientExtensionResults": map[string]any{},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal assertion response: %v", err)
	}
	return raw
}

// ---------- harness ----------

func testConfig(inviteOnly bool) config.Config {
	return config.Config{RPID: testRPID, Origin: testOrigin, RPName: "Set & Signal", InviteOnly: inviteOnly}
}

func newTestWebAuthn(t *testing.T, inviteOnly bool) (*WebAuthn, *store.Store) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store open: %v", err)
	}
	t.Cleanup(func() { _ = st.DB.Close() })
	w, err := New(st, testConfig(inviteOnly))
	if err != nil {
		t.Fatalf("webauthn.New: %v", err)
	}
	return w, st
}

// registrationChallenge extracts the b64url challenge and asserts the options
// contract (residentKey required, UV preferred, attestation none).
func registrationChallenge(t *testing.T, opts any) string {
	t.Helper()
	cc, ok := opts.(*protocol.CredentialCreation)
	if !ok {
		t.Fatalf("BeginRegistration opts type %T", opts)
	}
	sel := cc.Response.AuthenticatorSelection
	if sel.ResidentKey != protocol.ResidentKeyRequirementRequired || sel.UserVerification != protocol.VerificationPreferred {
		t.Fatalf("unexpected authenticatorSelection: %+v", sel)
	}
	if cc.Response.Attestation != protocol.PreferNoAttestation {
		t.Fatalf("attestation preference = %q, want none", cc.Response.Attestation)
	}
	return cc.Response.Challenge.String()
}

func loginChallenge(t *testing.T, opts any) string {
	t.Helper()
	ca, ok := opts.(*protocol.CredentialAssertion)
	if !ok {
		t.Fatalf("BeginLogin opts type %T", opts)
	}
	if len(ca.Response.AllowedCredentials) != 0 {
		t.Fatalf("allowCredentials must be empty for discoverable login, got %d", len(ca.Response.AllowedCredentials))
	}
	return ca.Response.Challenge.String()
}

// register runs the full registration ceremony for one fresh user.
func register(t *testing.T, w *WebAuthn, a *softAuthn, inviteCode string) store.User {
	t.Helper()
	cid, opts, err := w.BeginRegistration("Lucas", inviteCode)
	if err != nil {
		t.Fatalf("BeginRegistration: %v", err)
	}
	user, err := w.FinishRegistration(cid, a.registrationResponse(t, registrationChallenge(t, opts)))
	if err != nil {
		t.Fatalf("FinishRegistration: %v", err)
	}
	return user
}

// ---------- tests ----------

func TestRegistrationAndDiscoverableLoginHappyPath(t *testing.T) {
	w, st := newTestWebAuthn(t, false)
	authn := newSoftAuthn(t)

	user := register(t, w, authn, "")
	if user.ID == "" || user.Name != "Lucas" {
		t.Fatalf("registered user = %+v", user)
	}

	cred, err := st.CredentialByID(b64u(authn.credID))
	if err != nil || cred == nil {
		t.Fatalf("credential stored: %v %+v", err, cred)
	}
	if cred.UserID != user.ID || cred.Counter != 0 {
		t.Fatalf("stored credential = %+v user.ID=%s", cred, user.ID)
	}

	// Login round-trip.
	cid, opts, err := w.BeginLogin()
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	loggedIn, err := w.FinishLogin(cid, authn.assertionResponse(t, loginChallenge(t, opts), []byte(user.ID)))
	if err != nil {
		t.Fatalf("FinishLogin: %v", err)
	}
	if loggedIn.ID != user.ID || loggedIn.Name != user.Name {
		t.Fatalf("login returned %+v, want id %s", loggedIn, user.ID)
	}

	// Counter advanced from 0 to the assertion's sign count (1).
	cred, err = st.CredentialByID(b64u(authn.credID))
	if err != nil {
		t.Fatalf("credential reload: %v", err)
	}
	if cred.Counter != 1 {
		t.Fatalf("counter after first login = %d, want 1", cred.Counter)
	}

	// A second ceremony advances it again.
	cid, opts, err = w.BeginLogin()
	if err != nil {
		t.Fatalf("BeginLogin #2: %v", err)
	}
	if _, err := w.FinishLogin(cid, authn.assertionResponse(t, loginChallenge(t, opts), []byte(user.ID))); err != nil {
		t.Fatalf("FinishLogin #2: %v", err)
	}
	cred, _ = st.CredentialByID(b64u(authn.credID))
	if cred.Counter != 2 {
		t.Fatalf("counter after second login = %d, want 2", cred.Counter)
	}
}

func TestNameValidationTrimsAndCaps(t *testing.T) {
	w, _ := newTestWebAuthn(t, false)

	if _, _, err := w.BeginRegistration("   ", ""); !errors.Is(err, ErrInvalidName) {
		t.Fatalf("empty name err = %v, want ErrInvalidName", err)
	}

	long := ""
	for i := range 50 {
		long += fmt.Sprint(i % 10)
	}
	cid, opts, err := w.BeginRegistration(long, "")
	if err != nil {
		t.Fatalf("long name rejected outright: %v", err)
	}
	user, err := w.FinishRegistration(cid, newSoftAuthn(t).registrationResponse(t, registrationChallenge(t, opts)))
	if err != nil {
		t.Fatalf("FinishRegistration: %v", err)
	}
	if got := len([]rune(user.Name)); got > 40 {
		t.Fatalf("name length %d exceeds cap of 40", got)
	}
}

func TestDuplicateCredentialRejected(t *testing.T) {
	w, _ := newTestWebAuthn(t, false)
	authn := newSoftAuthn(t)

	register(t, w, authn, "")

	cid, opts, err := w.BeginRegistration("Someone Else", "")
	if err != nil {
		t.Fatalf("BeginRegistration: %v", err)
	}
	_, err = w.FinishRegistration(cid, authn.registrationResponse(t, registrationChallenge(t, opts)))
	if !errors.Is(err, store.ErrDuplicateCredential) {
		t.Fatalf("duplicate credential err = %v, want store.ErrDuplicateCredential", err)
	}
}

func TestExpiredChallengeRejected(t *testing.T) {
	w, st := newTestWebAuthn(t, false)

	// Plant an already-expired challenge directly.
	payload, _ := json.Marshal(challengePayload{Challenge: "stale-challenge"})
	if err := st.PutChallenge("expired-cid", payload, time.Now().Add(-time.Minute).Unix()); err != nil {
		t.Fatalf("PutChallenge: %v", err)
	}
	if _, err := w.FinishRegistration("expired-cid", []byte("{}")); !errors.Is(err, ErrChallengeExpired) {
		t.Fatalf("registration with expired challenge: err=%v, want ErrChallengeExpired", err)
	}
	if _, err := w.FinishLogin("expired-cid", []byte("{}")); !errors.Is(err, ErrChallengeExpired) {
		t.Fatalf("login with expired challenge: err=%v, want ErrChallengeExpired", err)
	}

	// Challenges are single-use: a second take yields nothing even when unexpired.
	fresh, _ := json.Marshal(challengePayload{Challenge: "fresh-challenge"})
	if err := st.PutChallenge("single-use", fresh, time.Now().Add(time.Minute).Unix()); err != nil {
		t.Fatalf("PutChallenge: %v", err)
	}
	if _, err := st.TakeChallenge("single-use"); err != nil {
		t.Fatalf("first take: %v", err)
	}
	if raw, err := st.TakeChallenge("single-use"); err != nil || raw != nil {
		t.Fatalf("second take should be empty: %v %s", err, raw)
	}
}

func TestLoginChallengeCannotMintRegistration(t *testing.T) {
	// A live /api/login/options cid fed to registration verify must be
	// rejected before verification — otherwise an attacker mints an account
	// and bypasses the invite burn in INVITE_ONLY deployments.
	w, st := newTestWebAuthn(t, true)
	if err := st.UpsertInvite(store.Invite{Code: "GATE-1"}); err != nil {
		t.Fatalf("UpsertInvite: %v", err)
	}

	cid, _, err := w.BeginLogin()
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	// The challenge itself is valid; only the missing UID makes it unusable
	// for registration, so the body never gets parsed.
	if _, err := w.FinishRegistration(cid, []byte("{}")); !errors.Is(err, ErrChallengeExpired) {
		t.Fatalf("login cid through FinishRegistration err = %v, want ErrChallengeExpired", err)
	}
	// Nothing leaked: no user was created and the invite still burns later.
	users, _ := st.Users()
	if len(users) != 0 {
		t.Fatalf("users created despite rejection: %+v", users)
	}
	invites, _ := st.Invites()
	for _, inv := range invites {
		if inv.Code == "GATE-1" && inv.UsedBy != "" {
			t.Fatalf("invite burned despite rejection: %+v", inv)
		}
	}
}

func TestUnknownCredentialOnLogin(t *testing.T) {
	w, _ := newTestWebAuthn(t, false)
	register(t, w, newSoftAuthn(t), "")

	stranger := newSoftAuthn(t)
	cid, opts, err := w.BeginLogin()
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	if _, err := w.FinishLogin(cid, stranger.assertionResponse(t, loginChallenge(t, opts), []byte("who"))); !errors.Is(err, ErrUnknownCredential) {
		t.Fatalf("unknown credential err = %v, want ErrUnknownCredential", err)
	}
}

func TestDisabledAccountLoginRejected(t *testing.T) {
	w, st := newTestWebAuthn(t, false)
	authn := newSoftAuthn(t)
	user := register(t, w, authn, "")
	if err := st.SetDisabled(user.ID, true); err != nil {
		t.Fatalf("SetDisabled: %v", err)
	}

	cid, opts, err := w.BeginLogin()
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	if _, err := w.FinishLogin(cid, authn.assertionResponse(t, loginChallenge(t, opts), []byte(user.ID))); !errors.Is(err, ErrAccountDisabled) {
		t.Fatalf("disabled login err = %v, want ErrAccountDisabled", err)
	}
	// Upstream ordering: the (valid) assertion's counter persists before 403.
	cred, err := st.CredentialByID(b64u(authn.credID))
	if err != nil {
		t.Fatalf("credential reload: %v", err)
	}
	if cred.Counter != 1 {
		t.Fatalf("counter after rejected login = %d, want 1", cred.Counter)
	}
}

func TestInviteOnlyFlow(t *testing.T) {
	w, st := newTestWebAuthn(t, true)

	// Without a code the options step refuses.
	if _, _, err := w.BeginRegistration("Lucas", ""); !errors.Is(err, ErrInviteRequired) {
		t.Fatalf("no-code err = %v, want ErrInviteRequired", err)
	}
	// Revoked codes refuse too.
	if err := st.UpsertInvite(store.Invite{Code: "REVOKED", Revoked: true}); err != nil {
		t.Fatalf("UpsertInvite: %v", err)
	}
	if _, _, err := w.BeginRegistration("Lucas", "revoked"); !errors.Is(err, ErrInviteRequired) {
		t.Fatalf("revoked-code err = %v, want ErrInviteRequired", err)
	}

	// Burn the code between Begin and Finish — Finish must notice.
	if err := st.UpsertInvite(store.Invite{Code: "WELCOME1"}); err != nil {
		t.Fatalf("UpsertInvite: %v", err)
	}
	cidStale, optsStale, err := w.BeginRegistration("Lucas", "welcome1")
	if err != nil {
		t.Fatalf("BeginRegistration: %v", err)
	}
	if err := st.UpsertInvite(store.Invite{Code: "WELCOME1", UsedBy: "someone-else"}); err != nil {
		t.Fatalf("burn invite early: %v", err)
	}
	if _, err := w.FinishRegistration(cidStale, newSoftAuthn(t).registrationResponse(t, registrationChallenge(t, optsStale))); !errors.Is(err, store.ErrInviteNotValid) {
		t.Fatalf("stale invite err = %v, want store.ErrInviteNotValid", err)
	}

	// Happy path with a fresh valid code (case-insensitive input).
	if err := st.UpsertInvite(store.Invite{Code: "FRESH-CODE"}); err != nil {
		t.Fatalf("UpsertInvite: %v", err)
	}
	cid, opts, err := w.BeginRegistration("Lucas", "fresh-code")
	if err != nil {
		t.Fatalf("BeginRegistration: %v", err)
	}
	authn := newSoftAuthn(t)
	user, err := w.FinishRegistration(cid, authn.registrationResponse(t, registrationChallenge(t, opts)))
	if err != nil {
		t.Fatalf("FinishRegistration: %v", err)
	}
	if user.InvitedBy != "FRESH-CODE" {
		t.Fatalf("invitedBy = %q, want FRESH-CODE", user.InvitedBy)
	}
	invites, _ := st.Invites()
	for _, inv := range invites {
		if inv.Code == "FRESH-CODE" && (inv.UsedBy != user.ID || inv.UsedAt == "") {
			t.Fatalf("invite not burned properly: %+v", inv)
		}
	}
}
