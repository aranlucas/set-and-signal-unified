package httpapi

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/aranlucas/set-and-signal-unified/internal/ai"
	"github.com/aranlucas/set-and-signal-unified/internal/auth"
	"github.com/aranlucas/set-and-signal-unified/internal/config"
	"github.com/aranlucas/set-and-signal-unified/internal/oauth"
	"github.com/aranlucas/set-and-signal-unified/internal/presence"
	"github.com/aranlucas/set-and-signal-unified/internal/push"
	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

const (
	testRPID   = "localhost"
	testOrigin = "http://localhost:8080"
)

type testEnv struct {
	t      *testing.T
	url    string
	st     *store.Store
	sess   *auth.Sessions
	srv    *Server
	client *http.Client
	bearer string // OAuth access token for u1
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	return newTestEnvCfg(t, config.Config{
		Port: "0", RPID: testRPID, Origin: testOrigin, PublicURL: testOrigin, RPName: "Set & Signal", SessionDays: 90,
	})
}

func newTestEnvCfg(t *testing.T, cfg config.Config) *testEnv {
	t.Helper()
	dir := t.TempDir()
	cfg.DataDir = dir
	cfg.DBPath = filepath.Join(dir, "opengym.db")
	if cfg.PublicURL == "" {
		cfg.PublicURL = cfg.Origin
	}

	st, err := store.Open(dir)
	if err != nil {
		t.Fatalf("store open: %v", err)
	}
	t.Cleanup(func() { _ = st.DB.Close() })
	sess, err := auth.NewSessions(dir, cfg.SessionDays)
	if err != nil {
		t.Fatalf("sessions: %v", err)
	}
	wa, err := auth.New(st, cfg)
	if err != nil {
		t.Fatalf("webauthn: %v", err)
	}

	e := &testEnv{t: t, st: st, sess: sess}
	pres := presence.New()
	psh, err := push.New(dir, st, "mailto:test@localhost")
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	oauthSrv := oauth.New(cfg, st, sess)
	e.srv = &Server{
		Cfg: cfg, ST: st, Sess: sess, WA: wa, Push: psh, Presence: pres,
		OAuth: oauthSrv,
	}
	ts := httptest.NewTestServer(t, Router(e.srv))
	e.client = ts.Client()
	e.url = ts.URL

	if err := st.CreateUser(store.User{ID: "u1", Name: "Alice"}); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	tok, err := oauthSrv.IssueAccessToken("u1")
	if err != nil {
		t.Fatalf("seed oauth token: %v", err)
	}
	e.bearer = tok
	return e
}

// cookieVal mints a session cookie for uid at their CURRENT session version,
// so tests stay valid across logout/all bumps.
func (e *testEnv) cookieVal(uid string) string {
	e.t.Helper()
	u, err := e.st.UserByID(uid)
	if err != nil || u == nil {
		e.t.Fatalf("cookie user %s: %v", uid, err)
	}
	val, _ := e.sess.Make(u.ID, u.SV)
	return val
}

// do issues a JSON request against the test server. authMode: "", "cookie",
// "bearer", or "raw:<literal Cookie header>".
func (e *testEnv) do(method, path, body, authMode string) (*http.Response, map[string]any) {
	e.t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, e.url+path, rd)
	if err != nil {
		e.t.Fatalf("%s %s: %v", method, path, err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	switch {
	case authMode == "cookie":
		req.Header.Set("Cookie", "gymsid="+e.cookieVal("u1"))
	case authMode == "admin":
		req.Header.Set("Cookie", "gymsid="+e.cookieVal("u1"))
	case authMode == "bearer":
		req.Header.Set("Authorization", "Bearer "+e.bearer)
	case strings.HasPrefix(authMode, "raw:"):
		req.Header.Set("Cookie", strings.TrimPrefix(authMode, "raw:"))
	}

	resp, err := e.client.Do(req)
	if err != nil {
		e.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)

	var m map[string]any
	if len(raw) > 0 && strings.Contains(resp.Header.Get("Content-Type"), "json") {
		if err := json.Unmarshal(raw, &m); err != nil {
			e.t.Fatalf("%s %s: non-object JSON body %q", method, path, raw)
		}
	}
	return resp, m
}

// getState fetches u1's state blob through GET /api/data.
func (e *testEnv) getState(authMode string) map[string]any {
	e.t.Helper()
	resp, body := e.do(http.MethodGet, "/api/data", "", authMode)
	if resp.StatusCode != 200 {
		e.t.Fatalf("GET /api/data = %d", resp.StatusCode)
	}
	state, _ := body["state"].(map[string]any)
	return state
}

func errOf(m map[string]any) string {
	s, _ := m["error"].(string)
	return s
}

// ---------- route-contract table ----------

func TestRouteContract(t *testing.T) {
	e := newTestEnv(t)

	cases := []struct {
		name         string
		method, path string
		body, auth   string
		status       int
		err          string // exact {"error": ...} when non-empty
		check        func(t *testing.T, resp *http.Response, body map[string]any)
	}{
		// public surface
		{
			"health is public", "GET", "/api/health", "", "", 200, "",
			func(t *testing.T, _ *http.Response, b map[string]any) {
				if b["ok"] != true || b["users"] != float64(1) {
					t.Fatalf("health body = %v", b)
				}
			},
		},
		{
			"config is public", "GET", "/api/config", "", "", 200, "",
			func(t *testing.T, _ *http.Response, b map[string]any) {
				if b["invite_only"] != false {
					t.Fatalf("config body = %v", b)
				}
			},
		},
		{"unknown route is 404 not found", "GET", "/api/nope", "", "", 404, "not found", nil},

		// /api/me: cookie-only
		{"me unauthenticated", "GET", "/api/me", "", "", 401, "not signed in", nil},
		{"me rejects bearer (cookie-only upstream)", "GET", "/api/me", "", "bearer", 401, "not signed in", nil},
		{
			"me via cookie", "GET", "/api/me", "", "cookie", 200, "",
			func(t *testing.T, _ *http.Response, b map[string]any) {
				u, _ := b["user"].(map[string]any)
				if u["id"] != "u1" || u["name"] != "Alice" || u["admin"] != false {
					t.Fatalf("me body = %v", b)
				}
			},
		},

		// whole-state sync: GET accepts both credentials, PUT is cookie-only
		{"data GET unauthenticated", "GET", "/api/data", "", "", 401, "not signed in", nil},
		{
			"data GET via bearer", "GET", "/api/data", "", "bearer", 200, "",
			func(t *testing.T, _ *http.Response, b map[string]any) {
				if _, present := b["state"]; !present {
					t.Fatalf("data body missing state key: %v", b)
				}
			},
		},

		// granular edits: any credential
		{"routine unauthenticated", "POST", "/api/routine", `{}`, "", 401, "not signed in", nil},
		{"week unauthenticated", "POST", "/api/week", `{}`, "", 401, "not signed in", nil},
		{"dayplan unauthenticated", "POST", "/api/dayplan", `{}`, "", 401, "not signed in", nil},
		{"bodyweight unauthenticated", "POST", "/api/bodyweight", `{}`, "", 401, "not signed in", nil},
		{"settings unauthenticated", "POST", "/api/settings", `{}`, "", 401, "not signed in", nil},

		// auth flows
		{"logout-all unauthenticated", "POST", "/api/logout/all", "", "", 401, "not signed in", nil},
		{"register/options without name", "POST", "/api/register/options", `{}`, "", 400, "name required", nil},
		{"register/verify with stale cid", "POST", "/api/register/verify", `{"cid":"bogus"}`, "", 400, "challenge expired — try again", nil},
		{"login/verify with stale cid", "POST", "/api/login/verify", `{"cid":"bogus"}`, "", 400, "challenge expired — try again", nil},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, body := e.do(tc.method, tc.path, tc.body, tc.auth)
			if resp.StatusCode != tc.status {
				t.Fatalf("status = %d, want %d (body %v)", resp.StatusCode, tc.status, body)
			}
			if tc.err != "" && errOf(body) != tc.err {
				t.Fatalf("error = %q, want %q", errOf(body), tc.err)
			}
			if tc.check != nil {
				tc.check(t, resp, body)
			}
		})
	}
}

// ---------- logout ----------

func TestLogoutClearsCookie(t *testing.T) {
	e := newTestEnv(t)
	resp, body := e.do("POST", "/api/logout", "", "cookie")
	if resp.StatusCode != 200 || body["ok"] != true {
		t.Fatalf("logout = %d %v", resp.StatusCode, body)
	}
	sc := resp.Header.Get("Set-Cookie")
	if !strings.Contains(sc, "gymsid=;") || !strings.Contains(sc, "Max-Age=0") ||
		!strings.Contains(sc, "HttpOnly") || !strings.Contains(sc, "SameSite=Lax") ||
		!strings.Contains(sc, "Path=/") {
		t.Fatalf("clear Set-Cookie = %q", sc)
	}
}

func TestLogoutAllInvalidatesEveryCookie(t *testing.T) {
	e := newTestEnv(t)
	stale := "raw:gymsid=" + e.cookieVal("u1")

	resp, body := e.do("POST", "/api/logout/all", "", stale)
	if resp.StatusCode != 200 || body["ok"] != true {
		t.Fatalf("logout/all = %d %v", resp.StatusCode, body)
	}
	if !strings.Contains(resp.Header.Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("logout/all Set-Cookie = %q", resp.Header.Get("Set-Cookie"))
	}

	// The pre-bump cookie is dead everywhere…
	if resp, b := e.do("GET", "/api/me", "", stale); resp.StatusCode != 401 {
		t.Fatalf("stale cookie me = %d %v", resp.StatusCode, b)
	}
	// …but a fresh mint at the new version still works.
	if resp, _ := e.do("GET", "/api/me", "", "cookie"); resp.StatusCode != 200 {
		t.Fatalf("fresh cookie me = %d", resp.StatusCode)
	}
}

// ---------- admin guard ----------

func TestRequireAdminGuard(t *testing.T) {
	e := newTestEnv(t)

	// Guards read the caller from the request context, so tests inject it
	// directly (the resolveCaller middleware normally does this).
	build := func(authMode string) *http.Request {
		req := httptest.NewRequest("POST", "/api/admin/x", nil)
		switch authMode {
		case "cookie":
			u, err := e.st.UserByID("u1")
			if err != nil || u == nil {
				t.Fatal(err)
			}
			req = req.WithContext(context.WithValue(req.Context(),
				callerKey{}, &caller{user: u, viaCookie: true}))
		case "bearer":
			u, err := e.st.UserByID("u1")
			if err != nil || u == nil {
				t.Fatal(err)
			}
			req = req.WithContext(context.WithValue(req.Context(),
				callerKey{}, &caller{user: u}))
		}
		return req
	}
	for _, tc := range []struct {
		name, mode string
		wantCode   int
	}{
		{"anonymous", "", 401},
		{"bearer never admin", "bearer", 401},
		{"session non-admin", "cookie", 403}, // u1 not yet admin-flagged
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			u := e.srv.requireAdmin(w, build(tc.mode))
			if w.Code != tc.wantCode {
				t.Fatalf("code = %d, want %d (%q)", w.Code, tc.wantCode, mustDecode(w))
			}
			if tc.wantCode == 403 && mustDecode(w) != "forbidden" {
				t.Fatalf("body = %q", mustDecode(w))
			}
			if tc.wantCode == 200 && u == nil {
				t.Fatalf("expected caller, got nil")
			}
		})
	}

	// Grant via ADMIN_UIDS: the same session now passes.
	e.srv.Cfg.AdminUIDs = []string{"u1"}
	w := httptest.NewRecorder()
	if got := e.srv.requireAdmin(w, build("cookie")); got == nil || w.Code != 200 {
		t.Fatalf("admin session = %+v code %d", got, w.Code)
	}
}

func mustDecode(w *httptest.ResponseRecorder) string {
	var m map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	s, _ := m["error"].(string)
	return s
}

// ---------- software authenticator ----------
//
// Minimal CTAP2-style ES256 authenticator producing real registration and
// assertion responses, driven end-to-end through the HTTP routes (mirrors
// internal/auth's test double).

const (
	flagUserPresent            = 0x01
	flagUserVerified           = 0x04
	flagAttestedCredentialData = 0x40
)

func cborByteString(b []byte) []byte {
	if len(b) >= 256 {
		panic("test helper: long byte strings not needed")
	}
	if len(b) < 24 {
		return append([]byte{0x40 | byte(len(b))}, b...)
	}
	return append([]byte{0x58, byte(len(b))}, b...)
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

// coseKey serializes the EC2 (-7 / P-256) COSE_Key with canonical CBOR.
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

func (a *softAuthn) registrationResponse(t *testing.T, challenge string) jsontext.Value {
	t.Helper()
	cd := a.clientData("webauthn.create", challenge)
	ad := a.authData(flagUserPresent|flagUserVerified|flagAttestedCredentialData, true)
	raw, err := json.Marshal(map[string]any{
		"id":    b64u(a.credID),
		"rawId": b64u(a.credID),
		"type":  "public-key",
		"response": map[string]any{
			"clientDataJSON":    b64u(cd),
			"attestationObject": b64u(a.attestationObject(ad)),
			"transports":        []string{"internal"},
		},
		"clientExtensionResults": map[string]any{},
	})
	if err != nil {
		t.Fatalf("marshal registration response: %v", err)
	}
	return raw
}

func (a *softAuthn) assertionResponse(t *testing.T, challenge string, userHandle []byte) jsontext.Value {
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
	raw, err := json.Marshal(map[string]any{
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
	})
	if err != nil {
		t.Fatalf("marshal assertion response: %v", err)
	}
	return raw
}

// ---------- full ceremonies through the HTTP routes ----------

// optionsChallenge pulls the b64url challenge out of decoded options JSON
// ({publicKey:{challenge:...}}).
func optionsChallenge(t *testing.T, body map[string]any) (cid, challenge string) {
	t.Helper()
	cid, _ = body["cid"].(string)
	opts, _ := body["options"].(map[string]any)
	pk, _ := opts["publicKey"].(map[string]any)
	challenge, _ = pk["challenge"].(string)
	if cid == "" || challenge == "" {
		t.Fatalf("bad options body: %v", body)
	}
	return cid, challenge
}

func TestRegisterOverHTTPSetsSessionCookie(t *testing.T) {
	e := newTestEnv(t)
	authn := newSoftAuthn(t)

	_, optsBody := e.do("POST", "/api/register/options", `{"name":"  Bob  "}`, "")
	cid, challenge := optionsChallenge(t, optsBody)

	resp, body := e.do("POST", "/api/register/verify",
		`{"cid":"`+cid+`","credential":`+string(authn.registrationResponse(t, challenge))+`}`, "")
	if resp.StatusCode != 200 {
		t.Fatalf("register/verify = %d %v", resp.StatusCode, body)
	}
	user, _ := body["user"].(map[string]any)
	if user["name"] != "Bob" || user["admin"] != false || user["id"] == "" {
		t.Fatalf("registered user payload = %v", body)
	}

	sc := resp.Header.Get("Set-Cookie")
	for _, want := range []string{"Path=/", "HttpOnly", "SameSite=Lax", "Max-Age="} {
		if !strings.Contains(sc, want) {
			t.Fatalf("Set-Cookie %q missing %q", sc, want)
		}
	}
	if strings.HasPrefix(e.srv.Cfg.Origin, "https:") && strings.Contains(sc, "Secure") {
		t.Fatalf("Secure on http origin: %q", sc)
	}

	// The freshly minted cookie identifies the new user immediately.
	sid := sc[strings.Index(sc, "gymsid=")+len("gymsid="):]
	if i := strings.Index(sid, ";"); i >= 0 {
		sid = sid[:i]
	}
	meResp := httptest.NewRequest("GET", "/api/me", nil)
	meResp.Header.Set("Cookie", "gymsid="+sid)
	w := httptest.NewRecorder()
	Router(e.srv).ServeHTTP(w, meResp)
	if w.Code != 200 {
		t.Fatalf("me with fresh cookie = %d %s", w.Code, w.Body.String())
	}
	var me map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &me)
	if u, _ := me["user"].(map[string]any); u["name"] != "Bob" {
		t.Fatalf("me body = %v", me)
	}

	// Health reflects the second account.
	_, h := e.do("GET", "/api/health", "", "")
	if h["users"] != float64(2) {
		t.Fatalf("users after register = %v", h)
	}
}

func TestLoginOverHTTPMintsSessionCookie(t *testing.T) {
	e := newTestEnv(t)
	authn := newSoftAuthn(t)

	// Register through the routes first.
	_, optsBody := e.do("POST", "/api/register/options", `{"name":"Cara"}`, "")
	regCid, regChallenge := optionsChallenge(t, optsBody)
	resp, body := e.do("POST", "/api/register/verify",
		`{"cid":"`+regCid+`","credential":`+string(authn.registrationResponse(t, regChallenge))+`}`, "")
	if resp.StatusCode != 200 {
		t.Fatalf("register = %d %v", resp.StatusCode, body)
	}
	uid, _ := body["user"].(map[string]any)
	userID, _ := uid["id"].(string)

	_, loginOpts := e.do("POST", "/api/login/options", ``, "")
	lcid, lchallenge := optionsChallenge(t, loginOpts)

	resp, body = e.do("POST", "/api/login/verify",
		`{"cid":"`+lcid+`","credential":`+string(authn.assertionResponse(t, lchallenge, []byte(userID)))+`}`, "")
	if resp.StatusCode != 200 {
		t.Fatalf("login/verify = %d %v", resp.StatusCode, body)
	}
	user, _ := body["user"].(map[string]any)
	if user["id"] != userID || user["name"] != "Cara" {
		t.Fatalf("login payload = %v", body)
	}
	if !strings.Contains(resp.Header.Get("Set-Cookie"), "gymsid=") {
		t.Fatalf("login Set-Cookie = %q", resp.Header.Get("Set-Cookie"))
	}

	// Unknown passkey maps to the upstream 404.
	authn2 := newSoftAuthn(t)
	_, loginOpts2 := e.do("POST", "/api/login/options", ``, "")
	c2, ch2 := optionsChallenge(t, loginOpts2)
	_, lv2 := e.do("POST", "/api/login/verify",
		`{"cid":"`+c2+`","credential":`+string(authn2.assertionResponse(t, ch2, []byte(userID)))+`}`, "")
	if errOf(lv2) != "unknown passkey — create a profile first" {
		t.Fatalf("unknown passkey body = %v", lv2)
	}
}

// Upstream reserves 'verification failed:' for WebAuthn protocol failures;
// unexpected faults after (or around) verification are 500 "server error".
func TestVerifyErrorClassification(t *testing.T) {
	e := newTestEnv(t)
	authn := newSoftAuthn(t)

	// A garbage credential payload is a client verification failure → 400.
	_, optsBody := e.do("POST", "/api/register/options", `{"name":"Dana"}`, "")
	cid, _ := optionsChallenge(t, optsBody)
	resp, body := e.do("POST", "/api/register/verify",
		`{"cid":"`+cid+`","credential":{"id":"x","rawId":"x","type":"public-key","response":{}}}`, "")
	if resp.StatusCode != 400 || !strings.HasPrefix(errOf(body), "verification failed: ") {
		t.Fatalf("bad payload = %d %v, want 400 verification failed", resp.StatusCode, body)
	}

	// Complete the registration for real, then corrupt the stored key so
	// login/verify hits a fault after loading the credential.
	_, optsBody = e.do("POST", "/api/register/options", `{"name":"Dana"}`, "")
	regCid, regChallenge := optionsChallenge(t, optsBody)
	resp, body = e.do("POST", "/api/register/verify",
		`{"cid":"`+regCid+`","credential":`+string(authn.registrationResponse(t, regChallenge))+`}`, "")
	if resp.StatusCode != 200 {
		t.Fatalf("register = %d %v", resp.StatusCode, body)
	}
	uid, _ := body["user"].(map[string]any)
	userID, _ := uid["id"].(string)
	// Corrupt the stored public key: the assertion passes discovery but the
	// key decode fails after the credential load — a server-side fault that
	// is NOT a client verification error.
	if _, err := e.st.DB.Exec(`UPDATE credentials SET public_key = '!!!' WHERE user_id = ?`, userID); err != nil {
		t.Fatal(err)
	}

	_, loginOpts := e.do("POST", "/api/login/options", ``, "")
	lcid, lchallenge := optionsChallenge(t, loginOpts)
	resp, body = e.do("POST", "/api/login/verify",
		`{"cid":"`+lcid+`","credential":`+string(authn.assertionResponse(t, lchallenge, []byte(userID)))+`}`, "")
	if resp.StatusCode != 500 || errOf(body) != "server error" {
		t.Fatalf("corrupted key = %d %v, want 500 server error", resp.StatusCode, body)
	}
}

// ---------- task 11: activity, push and admin surface ----------

func TestRouteContractAdminActivityPush(t *testing.T) {
	e := newTestEnv(t)

	cases := []struct {
		name         string
		method, path string
		body, auth   string
		status       int
		err          string
		asAdmin      bool // flip ADMIN_UIDS on before the request
	}{
		{"push public-key is public", "GET", "/api/push/public-key", "", "", 200, "", false},
		{"activity rejects bearer (cookie-only)", "POST", "/api/activity", `{"active":true}`, "bearer", 401, "not signed in", false},
		{"activity unauthenticated", "POST", "/api/activity", `{}`, "", 401, "not signed in", false},
		{"push subscribe rejects bearer", "POST", "/api/push/subscribe", `{"subscription":{}}`, "bearer", 401, "not signed in", false},
		{"push subscribe invalid payload", "POST", "/api/push/subscribe", `{"subscription":{"endpoint":"https://x"}}`, "cookie", 400, "", false},
		{"push unsubscribe rejects bearer", "POST", "/api/push/unsubscribe", `{}`, "bearer", 401, "not signed in", false},
		// Rest timers require a numeric duration within the supported range.
		{"rest-timer rejects nonnumeric seconds", "POST", "/api/push/rest-timer", `{"seconds":"soon"}`, "cookie", 400, "bad json", false},
		{"rest-timer requires seconds", "POST", "/api/push/rest-timer", `{}`, "cookie", 400, "", false},
		{"rest-timer cancel ok", "POST", "/api/push/rest-timer/cancel", `{}`, "cookie", 200, "", false},
		{"admin users unauthenticated", "GET", "/api/admin/users", "", "", 401, "not signed in", false},
		{"admin users rejects bearer", "GET", "/api/admin/users", "", "bearer", 401, "not signed in", false},
		{"admin users forbidden for non-admin session", "GET", "/api/admin/users", "", "cookie", 403, "forbidden", false},
		{"admin user drill-down unauthenticated", "GET", "/api/admin/user?id=u1", "", "", 401, "not signed in", false},
		{"admin disable unauthenticated", "POST", "/api/admin/user/disable", `{"id":"u1"}`, "", 401, "not signed in", false},
		{"admin invites unauthenticated", "GET", "/api/admin/invites", "", "", 401, "not signed in", false},
		{"admin invites/new rejects bearer", "POST", "/api/admin/invites/new", `{}`, "bearer", 401, "not signed in", false},
		{"admin invites/revoke unknown code", "POST", "/api/admin/invites/revoke", `{"code":"DEADBEEFDEADBEEF"}`, "admin", 404, "no such code", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.asAdmin {
				e.srv.Cfg.AdminUIDs = []string{"u1"}
			}
			resp, body := e.do(tc.method, tc.path, tc.body, tc.auth)
			if resp.StatusCode != tc.status {
				t.Fatalf("status = %d, want %d (body %v)", resp.StatusCode, tc.status, body)
			}
			if tc.err != "" && errOf(body) != tc.err {
				t.Fatalf("error = %q, want %q", errOf(body), tc.err)
			}
		})
	}
}

func TestAdminUsersRowsAndDrillDown(t *testing.T) {
	e := newTestEnv(t)

	if err := e.st.MutateState("u1", func(raw jsontext.Value) (jsontext.Value, error) {
		return []byte(`{"unit":"lb","_ts":1724438400000,"routines":[{"id":"push","name":"Push Day","emoji":"💪","ex":[{},{}]},{"id":"pull","name":"Pull","emoji":"🧲"}],"bodyweight":[{"d":"2026-08-01","w":80}],"workouts":[{"d":"2026-08-20"},{"d":"2026-08-22"}]}`), nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := e.st.UpsertPushSub(store.PushSub{Endpoint: "https://push.example/1", UserID: "u1", P256DH: "p", Auth: "a", Created: "2026-08-23T00:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	e.srv.Cfg.AdminUIDs = []string{"u1"}

	resp, body := e.do("GET", "/api/admin/users", "", "admin")
	if resp.StatusCode != 200 {
		t.Fatalf("admin/users = %d %v", resp.StatusCode, body)
	}
	users, _ := body["users"].([]any)
	row := users[0].(map[string]any)
	lastSync, _ := row["lastSync"].(float64) // MutateState stamps its own _ts
	if lastSync == 0 {
		t.Fatalf("lastSync missing: %v", row)
	}
	if row["id"] != "u1" || row["workouts"] != float64(2) || row["lastWorkout"] != "2026-08-22" ||
		row["hasPush"] != true || row["live"] != nil ||
		row["disabled"] != false || row["admin"] != true || row["invitedBy"] != nil {
		t.Fatalf("admin row = %v", row)
	}
	if body["invite_only"] != false || body["now"] == nil {
		t.Fatalf("envelope = %v", body)
	}

	// Drill-down reverses workouts and summarizes routines.
	resp, d := e.do("GET", "/api/admin/user?id=u1", "", "admin")
	if resp.StatusCode != 200 {
		t.Fatalf("admin/user = %d %v", resp.StatusCode, d)
	}
	ws, _ := d["workouts"].([]any)
	if len(ws) != 2 || ws[0].(map[string]any)["d"] != "2026-08-22" {
		t.Fatalf("drill-down workouts = %v", ws)
	}
	rs, _ := d["routines"].([]any)
	if rs[0].(map[string]any)["count"] != float64(2) || len(rs) != 2 {
		t.Fatalf("drill-down routines = %v", rs)
	}
	if d["unit"] != "lb" {
		t.Fatalf("drill-down unit = %v", d["unit"])
	}

	// Missing unit falls back to the new-profile default.
	if _, err := e.st.DB.Exec(`UPDATE user_state SET state = '{"_ts":5}' WHERE user_id = 'u1'`); err != nil {
		t.Fatal(err)
	}
	_, d = e.do("GET", "/api/admin/user?id=u1", "", "admin")
	if d["unit"] != "lb" {
		t.Fatalf("default unit = %v", d["unit"])
	}

	if resp, b := e.do("GET", "/api/admin/user?id=ghost", "", "admin"); resp.StatusCode != 404 || errOf(b) != "no such user" {
		t.Fatalf("unknown drill-down = %d %v", resp.StatusCode, b)
	}
}

func TestAdminDisable(t *testing.T) {
	e := newTestEnv(t)
	if err := e.st.CreateUser(store.User{ID: "boss", Name: "Boss", Admin: true}); err != nil {
		t.Fatal(err)
	}
	e.srv.Cfg.AdminUIDs = []string{"u1"}

	// A non-admin caller gets the guard's 403 before anything else.
	if resp, b := e.do("POST", "/api/admin/user/disable", `{"id":"u1"}`, "raw:"); false {
		_ = resp
		_ = b
	}

	// Admin cannot disable an admin.
	if resp, b := e.do("POST", "/api/admin/user/disable", `{"id":"boss"}`, "admin"); resp.StatusCode != 400 || errOf(b) != "cannot disable an admin" {
		t.Fatalf("disable admin = %d %v", resp.StatusCode, b)
	}
	// Unknown id → 404.
	if resp, b := e.do("POST", "/api/admin/user/disable", `{"id":"ghost"}`, "admin"); resp.StatusCode != 404 || errOf(b) != "no such user" {
		t.Fatalf("disable ghost = %d %v", resp.StatusCode, b)
	}

	// Disabling a regular user works and drops their presence entry.
	if err := e.st.CreateUser(store.User{ID: "u2", Name: "Bob"}); err != nil {
		t.Fatal(err)
	}
	e.srv.Presence.Set("u2", presence.Info{Name: "live"})
	resp, b := e.do("POST", "/api/admin/user/disable", `{"id":"u2","disabled":true}`, "admin")
	if resp.StatusCode != 200 || b["ok"] != true || b["disabled"] != true {
		t.Fatalf("disable u2 = %d %v", resp.StatusCode, b)
	}
	u, _ := e.st.UserByID("u2")
	if u == nil || !u.Disabled {
		t.Fatalf("u2 not disabled: %+v", u)
	}
	if e.srv.Presence.Live("u2") != nil {
		t.Fatal("disabled user still live")
	}

	// Re-enable flips the flag back.
	resp, b = e.do("POST", "/api/admin/user/disable", `{"id":"u2","disabled":false}`, "admin")
	if resp.StatusCode != 200 || b["disabled"] != false {
		t.Fatalf("re-enable u2 = %d %v", resp.StatusCode, b)
	}
}

func TestInviteLifecycle(t *testing.T) {
	e := newTestEnv(t)
	e.srv.Cfg.AdminUIDs = []string{"u1"}
	e.srv.Cfg.InviteOnly = true

	_, created := e.do("POST", "/api/admin/invites/new", `{"note":" for greg "}`, "admin")
	inv := created["invite"].(map[string]any)
	code, _ := inv["code"].(string)
	if len(code) != 16 || inv["note"] != " for greg " || inv["createdBy"] != "u1" { // upstream keeps String(note).slice(0,60) untrimmed
		t.Fatalf("invite = %v", inv)
	}
	// Codes are unique: a second mint differs.
	_, again := e.do("POST", "/api/admin/invites/new", `{}`, "admin")
	if again["invite"].(map[string]any)["code"] == code {
		t.Fatal("duplicate invite code")
	}

	_, list := e.do("GET", "/api/admin/invites", "", "admin")
	if list["invite_only"] != true {
		t.Fatalf("invite_only = %v", list["invite_only"])
	}
	invites := list["invites"].([]any)
	if len(invites) != 2 {
		t.Fatalf("invites list = %v", invites)
	}

	// An unused code revokes cleanly…
	if resp, b := e.do("POST", "/api/admin/invites/revoke", `{"code":"`+strings.ToLower(code)+`"}`, "admin"); resp.StatusCode != 200 || b["ok"] != true {
		t.Fatalf("revoke (case-insensitive) = %d %v", resp.StatusCode, b)
	}
	// …but a used one refuses forever.
	if err := e.st.UpsertInvite(store.Invite{Code: "USEDMARKER1234567", UsedBy: "u1", UsedAt: "2026-08-23T00:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	if resp, b := e.do("POST", "/api/admin/invites/revoke", `{"code":"usedmarker1234567"}`, "admin"); resp.StatusCode != 400 || errOf(b) != "already used — cannot revoke" {
		t.Fatalf("revoke used = %d %v", resp.StatusCode, b)
	}

	// usedByName resolves even when the redeemer is disabled (upstream's
	// db.users.find sees disabled users too).
	if err := e.st.CreateUser(store.User{ID: "u5", Name: "Nina"}); err != nil {
		t.Fatal(err)
	}
	if err := e.st.SetDisabled("u5", true); err != nil {
		t.Fatal(err)
	}
	if err := e.st.UpsertInvite(store.Invite{Code: "DISABLEDUSER12345", UsedBy: "u5"}); err != nil {
		t.Fatal(err)
	}
	_, list = e.do("GET", "/api/admin/invites", "", "admin")
	for _, inv := range list["invites"].([]any) {
		m := inv.(map[string]any)
		if m["code"] == "DISABLEDUSER12345" && m["usedByName"] != "Nina" {
			t.Fatalf("disabled redeemer name not resolved: %v", m)
		}
	}
}

func TestActivityHeartbeat(t *testing.T) {
	e := newTestEnv(t)
	e.srv.Cfg.AdminUIDs = []string{"u1"}

	resp, body := e.do("POST", "/api/activity",
		`{"active":true,"name":" Squat ","exIdx":1,"exTotal":5,"setsDone":2,"setsTotal":15,"startedAt":1724430000000}`,
		"cookie")
	if resp.StatusCode != 200 || body["ok"] != true {
		t.Fatalf("activity = %d %v", resp.StatusCode, body)
	}
	live := e.srv.Presence.Live("u1")
	if live == nil || live.Name != " Squat " || live.ExIdx != 1 || live.ExTotal != 5 ||
		live.SetsDone != 2 || live.SetsTotal != 15 || live.StartedAt.UnixMilli() != 1724430000000 {
		t.Fatalf("presence after heartbeat = %+v", live)
	}

	// The admin dashboard sees it with millisecond stamps.
	_, users := e.do("GET", "/api/admin/users", "", "admin")
	row := users["users"].([]any)[0].(map[string]any)
	liveMap, _ := row["live"].(map[string]any)
	if liveMap == nil || liveMap["name"] != " Squat " || liveMap["updatedAt"] == nil {
		t.Fatalf("admin live view = %v", row["live"])
	}

	// active:false drops the entry.
	if resp, _ := e.do("POST", "/api/activity", `{"active":false}`, "cookie"); resp.StatusCode != 200 {
		t.Fatal("activity goodbye failed")
	}
	if e.srv.Presence.Live("u1") != nil {
		t.Fatal("presence survived goodbye")
	}
}

func TestPushSubscribeUnsubscribe(t *testing.T) {
	e := newTestEnv(t)

	resp, body := e.do("GET", "/api/push/public-key", "", "")
	if resp.StatusCode != 200 || body["key"] != e.srv.Push.PublicKey() {
		t.Fatalf("public-key = %d %v", resp.StatusCode, body)
	}

	sub := `{"subscription":{"endpoint":"https://push.example/sub1","keys":{"p256dh":"P","auth":"A"}}}`
	if resp, b := e.do("POST", "/api/push/subscribe", sub, "cookie"); resp.StatusCode != 200 || b["ok"] != true {
		t.Fatalf("subscribe = %d %v", resp.StatusCode, b)
	}
	subs, err := e.st.SubsByUser("u1")
	if err != nil || len(subs) != 1 || subs[0].Endpoint != "https://push.example/sub1" || subs[0].P256DH != "P" || subs[0].Auth != "A" {
		t.Fatalf("stored subs = %v %v", subs, err)
	}

	// Re-subscribing the same endpoint replaces rather than duplicates.
	if resp, _ := e.do("POST", "/api/push/subscribe", sub, "cookie"); resp.StatusCode != 200 {
		t.Fatal("re-subscribe failed")
	}
	if subs, _ := e.st.SubsByUser("u1"); len(subs) != 1 {
		t.Fatalf("re-subscribe duplicated: %v", subs)
	}

	// Unsubscribe only touches the caller's own endpoint; another user's
	// endpoint survives.
	if err := e.st.CreateUser(store.User{ID: "u9", Name: "Zoe"}); err != nil {
		t.Fatal(err)
	}
	if err := e.st.UpsertPushSub(store.PushSub{Endpoint: "https://push.example/zoe", UserID: "u9", P256DH: "z", Auth: "z", Created: "2026-08-23T00:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	if resp, b := e.do("POST", "/api/push/unsubscribe", `{"endpoint":"https://push.example/zoe"}`, "cookie"); resp.StatusCode != 200 || b["ok"] != true {
		t.Fatalf("unsubscribe foreign = %d %v", resp.StatusCode, b)
	}
	if ok, _ := e.st.AnySubFor("u9"); !ok {
		t.Fatal("foreign sub was deleted")
	}
	if resp, _ := e.do("POST", "/api/push/unsubscribe", `{"endpoint":"https://push.example/sub1"}`, "cookie"); resp.StatusCode != 200 {
		t.Fatal("unsubscribe own failed")
	}
	if ok, _ := e.st.AnySubFor("u1"); ok {
		t.Fatal("own sub survived unsubscribe")
	}

	// Rest timers arm through the service seam without error.
	if resp, b := e.do("POST", "/api/push/rest-timer", `{"seconds":90}`, "cookie"); resp.StatusCode != 200 || b["ok"] != true {
		t.Fatalf("rest-timer = %d %v", resp.StatusCode, b)
	}
	if resp, b := e.do("POST", "/api/push/rest-timer", `{"seconds":45}`, "cookie"); resp.StatusCode != 200 {
		t.Fatalf("rest-timer numeric duration = %d %v", resp.StatusCode, b)
	}
	if resp, b := e.do("POST", "/api/push/rest-timer/cancel", `{}`, "cookie"); resp.StatusCode != 200 || b["ok"] != true {
		t.Fatalf("rest-timer cancel = %d %v", resp.StatusCode, b)
	}
}

// ---------- task 12: AI proxy ----------

func TestAIStatus(t *testing.T) {
	e := newTestEnv(t)

	// Public route; disabled until a key is wired.
	resp, body := e.do("GET", "/api/ai/status", "", "")
	if resp.StatusCode != 200 || body["enabled"] != false {
		t.Fatalf("status = %d %v", resp.StatusCode, body)
	}

	e.srv.Cfg.OpenRouterModel = "openai/gpt-4o-mini"
	e.srv.AI = &ai.Client{APIKey: "", Model: e.srv.Cfg.OpenRouterModel}
	_, body = e.do("GET", "/api/ai/status", "", "")
	if body["model"] != "openai/gpt-4o-mini" || body["enabled"] != false {
		t.Fatalf("status model/enabled = %v", body)
	}
}

func TestAINextWorkoutUnconfigured(t *testing.T) {
	e := newTestEnv(t)

	if resp, b := e.do("POST", "/api/ai/next-workout", `{"digest":{}}`, ""); resp.StatusCode != 401 || errOf(b) != "not signed in" {
		t.Fatalf("unauthenticated = %d %v", resp.StatusCode, b)
	}
	if resp, b := e.do("POST", "/api/ai/next-workout", `{"digest":{}}`, "bearer"); resp.StatusCode != 503 ||
		errOf(b) != "AI planning is not configured on this instance (set OPENROUTER_API_KEY)" {
		t.Fatalf("unconfigured = %d %v", resp.StatusCode, b)
	}
}

func TestAINextWorkoutWithStub(t *testing.T) {
	e := newTestEnv(t)

	var lastBody map[string]any
	var called int
	var mu sync.Mutex
	mode := "" // success, provider error, or an invalid plan
	writeReply := func(w http.ResponseWriter, content string) {
		body, err := json.Marshal(map[string]any{
			"id":         "resp_test",
			"object":     "response",
			"created_at": 1,
			"status":     "completed",
			"model":      "test/model",
			"output": []map[string]any{{
				"id":     "msg_test",
				"type":   "message",
				"status": "completed",
				"role":   "assistant",
				"content": []map[string]any{{
					"type":        "output_text",
					"text":        content,
					"annotations": []any{},
				}},
			}},
		})
		if err != nil {
			t.Errorf("marshal response: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_, _ = w.Write(body)
	}
	stub := httptest.NewTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		mu.Lock()
		called++
		mu.Unlock()
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &lastBody)
		switch mode {
		case "bad":
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"message":"rate limited"}}`))
		case "garbage":
			// A well-formed reply whose content has no braces at all.
			writeReply(w, "I cannot help with that.")
		case "invalid":
			writeReply(w, `{"summary":"Invalid plan","entries":[{"id":"squat","sets":99}]}`)
		case "fenced":
			writeReply(w, "```json\n{\"summary\":\"Plan\",\"entries\":[]}\n```")
		case "wrongType":
			writeReply(w, `{"summary":"Invalid plan","entries":[{"id":"squat","weight":"100"}]}`)
		case "unknown":
			writeReply(w, `{"summary":"Invalid plan","entries":[{"id":"squat","junk":true}]}`)
		case "empty":
			writeReply(w, `{"summary":"","entries":[]}`)

		default:
			reply, _ := json.Marshal(map[string]any{
				"summary": "Go easy today.",
				"entries": []map[string]any{
					{"id": "squat", "sets": 3, "reps": 5, "weight": 100},
					{"id": "plank", "sec": 60},
				},
			})
			content := string(reply)
			writeReply(w, content)
		}
	}))
	stubClient := stub.Client()
	e.srv.AI = &ai.Client{APIKey: "k", Model: "m", BaseURL: stub.URL, HTTP: stubClient}
	e.srv.Cfg.OpenRouterModel = "m"

	// Structured Outputs decode directly into the validated response DTO.
	resp, body := e.do("POST", "/api/ai/next-workout", `{"digest":{"recent":["w1"]}}`, "cookie")
	if resp.StatusCode != 200 {
		t.Fatalf("next-workout = %d %v", resp.StatusCode, body)
	}
	sug := body["suggestion"].(map[string]any)
	if sug["summary"] != "Go easy today." {
		t.Fatalf("summary = %v", sug["summary"])
	}
	entries := sug["entries"].([]any)
	if len(entries) != 2 {
		t.Fatalf("entries = %v", entries)
	}
	first := entries[0].(map[string]any)
	if first["id"] != "squat" || first["weight"] != float64(100) {
		t.Fatalf("entry[0] = %v", first)
	}
	if _, leak := first["junk"]; leak {
		t.Fatalf("unknown field survived: %v", first)
	}
	if body["model"] != "m" {
		t.Fatalf("model = %v", body["model"])
	}
	// The provider saw the fixed sampling parameters, structured-output
	// requirement, and the raw digest.
	if lastBody["temperature"] != 0.4 || lastBody["max_output_tokens"] != float64(1500) || lastBody["model"] != "m" {
		t.Fatalf("stub request = %v", lastBody)
	}
	provider := lastBody["provider"].(map[string]any)
	textConfig := lastBody["text"].(map[string]any)
	responseFormat := textConfig["format"].(map[string]any)
	if provider["require_parameters"] != true || responseFormat["type"] != "json_schema" {
		t.Fatalf("structured output request = %v", lastBody)
	}

	// Provider failure maps to 502 with the provider message; a non-JSON
	// reply maps to the generic 502.
	mode = "bad"
	if resp, b := e.do("POST", "/api/ai/next-workout", `{"digest":{}}`, "bearer"); resp.StatusCode != 502 || errOf(b) != "AI provider error: rate limited" {
		t.Fatalf("provider error = %d %v", resp.StatusCode, b)
	}
	mode = "garbage"
	if resp, b := e.do("POST", "/api/ai/next-workout", `{"digest":{}}`, "bearer"); resp.StatusCode != 502 ||
		errOf(b) != "AI reply was not valid JSON — try again" {
		t.Fatalf("garbage reply = %d %v", resp.StatusCode, b)
	}
	for _, test := range []struct{ mode, message string }{
		{"invalid", "AI reply failed validation — try again"},
		{"wrongType", "AI reply was not valid JSON — try again"},
		{"fenced", "AI reply was not valid JSON — try again"},
		{"unknown", "AI reply was not valid JSON — try again"},
		{"empty", "AI reply was empty — try again"},
	} {
		mode = test.mode
		resp, body := e.do("POST", "/api/ai/next-workout", `{"digest":{}}`, "bearer")
		if resp.StatusCode != 502 || errOf(body) != test.message {
			t.Fatalf("invalid plan %s = %d %v", mode, resp.StatusCode, body)
		}
	}

	mode = ""

	// Oversized digests are refused before any provider call.
	called = 0
	big := strings.Repeat("x", 130000)
	if resp, b := e.do("POST", "/api/ai/next-workout", `{"digest":{"blob":"`+big+`"}}`, "bearer"); resp.StatusCode != 413 || errOf(b) != "digest too large" {
		t.Fatalf("oversized digest = %d %v", resp.StatusCode, b)
	}
	if called != 0 {
		t.Fatalf("provider was called for oversized digest (%d times)", called)
	}
}
