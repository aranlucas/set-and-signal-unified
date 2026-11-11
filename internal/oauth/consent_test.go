package oauth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/aranlucas/set-and-signal-unified/internal/auth"
	"github.com/aranlucas/set-and-signal-unified/internal/config"
	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

const consentOrigin = "https://product.example"

type consentFixture struct {
	t        *testing.T
	st       *store.Store
	s        *Server
	sessions *auth.Sessions
	mux      http.Handler
	redirect string
}

func newConsentFixture(t *testing.T) *consentFixture {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.DB.Close() })
	for _, user := range []store.User{{ID: "alice", Name: "Alice"}, {ID: "mallory", Name: "Mallory"}} {
		if err := st.CreateUser(user); err != nil {
			t.Fatal(err)
		}
	}
	redirect := "https://client.example/callback"
	// Registration is open, so the client name and redirect URI are untrusted input.
	if err := st.SaveOAuthClient(store.OAuthClient{ClientID: "third-party", ClientName: `<b>Helper</b>`, RedirectURIs: []string{redirect}, GrantTypes: []string{"authorization_code", "refresh_token"}, TokenEndpointAuthMethod: "none"}); err != nil {
		t.Fatal(err)
	}
	sessions := &auth.Sessions{Secret: []byte("fixture-secret"), Days: 1}
	s := New(config.Config{PublicURL: consentOrigin, RPName: "Set & Signal"}, st, sessions)
	mux := chi.NewRouter()
	s.Mount(mux)
	return &consentFixture{t: t, st: st, s: s, sessions: sessions, mux: mux, redirect: redirect}
}

func (f *consentFixture) do(r *http.Request, uid string) *httptest.ResponseRecorder {
	if uid != "" {
		cookie, _ := f.sessions.Make(uid, 0)
		r.AddCookie(&http.Cookie{Name: "gymsid", Value: cookie})
	}
	w := httptest.NewRecorder()
	f.mux.ServeHTTP(w, r)
	return w
}

func (f *consentFixture) authorize(uid string) *httptest.ResponseRecorder {
	q := url.Values{"client_id": {"third-party"}, "redirect_uri": {f.redirect}, "response_type": {"code"}, "code_challenge_method": {"S256"}, "code_challenge": {pkceS256(strings.Repeat("v", 43))}, "state": {"client-state"}}
	return f.do(httptest.NewRequest("GET", consentOrigin+"/oauth/authorize?"+q.Encode(), nil), uid)
}

func (f *consentFixture) decide(key, token, decision, uid string) *httptest.ResponseRecorder {
	form := url.Values{"state": {key}, "token": {token}, "decision": {decision}}
	r := httptest.NewRequest("POST", consentOrigin+"/oauth/consent", strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	return f.do(r, uid)
}

var consentToken = regexp.MustCompile(`name="token" value="([^"]+)"`)

// openConsent follows a signed-in authorize request to the consent page and
// returns the request key and form token.
func (f *consentFixture) openConsent(location, uid string) (string, string) {
	f.t.Helper()
	u, err := url.Parse(location)
	if err != nil || u.Path != "/oauth/consent" || u.Query().Get("state") == "" {
		f.t.Fatalf("not sent to consent: %q", location)
	}
	page := f.do(httptest.NewRequest("GET", consentOrigin+location, nil), uid)
	match := consentToken.FindStringSubmatch(page.Body.String())
	if page.Code != 200 || match == nil {
		f.t.Fatalf("consent page: %d %s", page.Code, page.Body.String())
	}
	return u.Query().Get("state"), match[1]
}

func TestSignedInAuthorizeAsksBeforeIssuingACode(t *testing.T) {
	f := newConsentFixture(t)
	w := f.authorize("alice")
	location := w.Header().Get("Location")
	if w.Code != http.StatusFound || strings.HasPrefix(location, f.redirect) || strings.Contains(location, "code=") {
		t.Fatalf("authorize issued a code without approval: %d %q", w.Code, location)
	}
	if strings.Contains(location, "client-state") {
		t.Fatalf("consent URL exposes the client's request state: %q", location)
	}

	page := f.do(httptest.NewRequest("GET", consentOrigin+location, nil), "alice")
	body := page.Body.String()
	if page.Code != 200 {
		t.Fatalf("consent page status = %d", page.Code)
	}
	for _, want := range []string{"&lt;b&gt;Helper&lt;/b&gt;", "https://client.example", "Alice", "Read and change your workouts", "Set &amp; Signal"} {
		if !strings.Contains(body, want) {
			t.Errorf("consent page missing %q", want)
		}
	}
	if strings.Contains(body, "<b>Helper</b>") {
		t.Error("client name rendered as HTML")
	}
	if page.Header().Get("X-Frame-Options") != "DENY" || !strings.Contains(page.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Errorf("consent page can be framed: %v", page.Header())
	}

	for name, uid := range map[string]string{"anonymous": "", "another account": "mallory"} {
		if got := f.do(httptest.NewRequest("GET", consentOrigin+location, nil), uid); got.Code != http.StatusBadRequest {
			t.Errorf("%s consent page status = %d", name, got.Code)
		}
	}
}

func TestConsentApprovalIssuesOneBoundCode(t *testing.T) {
	f := newConsentFixture(t)
	key, token := f.openConsent(f.authorize("alice").Header().Get("Location"), "alice")

	for name, attempt := range map[string]*httptest.ResponseRecorder{
		"missing token":   f.decide(key, "", "allow", "alice"),
		"wrong token":     f.decide(key, token+"x", "allow", "alice"),
		"another account": f.decide(key, token, "allow", "mallory"),
		"anonymous":       f.decide(key, token, "allow", ""),
	} {
		if attempt.Code != http.StatusBadRequest {
			t.Errorf("%s approval status = %d", name, attempt.Code)
		}
	}

	approved := f.decide(key, token, "allow", "alice")
	u, _ := url.Parse(approved.Header().Get("Location"))
	if approved.Code != http.StatusFound || !strings.HasPrefix(u.String(), f.redirect) || u.Query().Get("state") != "client-state" || u.Query().Get("iss") != consentOrigin {
		t.Fatalf("approval redirect: %d %q", approved.Code, approved.Header().Get("Location"))
	}
	code, err := f.st.TakeOAuthCode(hashSecret(u.Query().Get("code")))
	if err != nil || code == nil || code.UserID != "alice" || code.ClientID != "third-party" {
		t.Fatalf("approved code not bound to the user and client: %+v %v", code, err)
	}
	if replay := f.decide(key, token, "allow", "alice"); replay.Code != http.StatusBadRequest {
		t.Fatalf("replayed approval status = %d", replay.Code)
	}
}

func TestConsentDenialReturnsAccessDenied(t *testing.T) {
	f := newConsentFixture(t)
	key, token := f.openConsent(f.authorize("alice").Header().Get("Location"), "alice")
	denied := f.decide(key, token, "deny", "alice")
	u, _ := url.Parse(denied.Header().Get("Location"))
	if denied.Code != http.StatusFound || u.Query().Get("error") != "access_denied" || u.Query().Get("state") != "client-state" || u.Query().Has("code") {
		t.Fatalf("denial redirect: %d %q", denied.Code, denied.Header().Get("Location"))
	}
	if replay := f.decide(key, token, "allow", "alice"); replay.Code != http.StatusBadRequest {
		t.Fatalf("approval after denial status = %d", replay.Code)
	}
}

func TestConsentRejectsCrossSiteSubmissions(t *testing.T) {
	f := newConsentFixture(t)
	key, token := f.openConsent(f.authorize("alice").Header().Get("Location"), "alice")
	form := url.Values{"state": {key}, "token": {token}, "decision": {"allow"}}
	r := httptest.NewRequest("POST", consentOrigin+"/oauth/consent", strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	if got := f.do(r, "alice"); got.Code != http.StatusForbidden || strings.Contains(got.Header().Get("Location"), "code=") {
		t.Fatalf("cross-site approval: %d %q", got.Code, got.Header().Get("Location"))
	}
	if approved := f.decide(key, token, "allow", "alice"); approved.Code != http.StatusFound {
		t.Fatalf("rejected cross-site attempt consumed the request: %d", approved.Code)
	}
}
