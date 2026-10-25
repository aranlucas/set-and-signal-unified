package oauth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/auth"
	"github.com/aranlucas/set-and-signal-unified/internal/config"
	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

func TestPasskeyResumeCompletesBoundPKCEFlowOnce(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.DB.Close() })
	user := store.User{ID: "native-user"}
	if err := st.CreateUser(user); err != nil {
		t.Fatal(err)
	}
	sessions := &auth.Sessions{Secret: []byte("fixture-secret"), Days: 1}
	s := New(config.Config{PublicURL: "https://product.example"}, st, sessions)
	redirect := "fivefold://oauth"
	if err := st.SaveOAuthClient(store.OAuthClient{ClientID: "android", RedirectURIs: []string{redirect}, GrantTypes: []string{"authorization_code", "refresh_token"}, TokenEndpointAuthMethod: "none"}); err != nil {
		t.Fatal(err)
	}
	challenge := pkceS256(strings.Repeat("v", 43))
	q := url.Values{"client_id": {"android"}, "redirect_uri": {redirect}, "response_type": {"code"}, "code_challenge_method": {"S256"}, "code_challenge": {challenge}, "state": {"native-state"}}
	w := httptest.NewRecorder()
	s.authorize(w, httptest.NewRequest("GET", "https://product.example/oauth/authorize?"+q.Encode(), nil))
	destination, _ := url.Parse(w.Header().Get("Location"))
	pendingState := destination.Query().Get("state")
	if w.Code != 302 || pendingState == "" {
		t.Fatalf("no pending authorization: %d %s", w.Code, w.Body.String())
	}
	login := httptest.NewRecorder()
	s.loginPage(login, httptest.NewRequest("GET", "https://product.example/oauth/login?state="+pendingState, nil))
	if login.Code != 200 || !strings.Contains(login.Body.String(), "Continue with a passkey") {
		t.Fatal("passkey-only installation cannot sign in")
	}
	attempt := func(authenticated bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "https://product.example/oauth/resume?state="+pendingState, nil)
		if authenticated {
			cookie, _ := sessions.Make(user.ID, user.SV)
			r.AddCookie(&http.Cookie{Name: "gymsid", Value: cookie})
		}
		w := httptest.NewRecorder()
		s.resumeSession(w, r)
		return w
	}
	if got := attempt(false); got.Code != 401 {
		t.Fatalf("anonymous resume: %d", got.Code)
	}
	completed := attempt(true)
	u, _ := url.Parse(completed.Header().Get("Location"))
	if completed.Code != 302 || u.Scheme != "fivefold" || u.Query().Get("state") != "native-state" || u.Query().Get("code") == "" {
		t.Fatalf("incorrect native redirect: %d %s", completed.Code, completed.Header().Get("Location"))
	}
	code, err := st.TakeOAuthCode(hashSecret(u.Query().Get("code")))
	if err != nil || code == nil || code.CodeChallenge != challenge || code.UserID != user.ID || code.Exp < time.Now().Unix() {
		t.Fatalf("unbound PKCE code: %+v %v", code, err)
	}
	if got := attempt(true); got.Code != 400 {
		t.Fatalf("replayed pending authorization: %d", got.Code)
	}
}
