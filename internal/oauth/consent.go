package oauth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"html"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

// consentPending is an authorization request whose user is known but has not
// yet approved the client. Any caller can register a client and choose its
// redirect URI, so a code is issued only after this explicit approval.
type consentPending struct {
	loginPending
	UserID string
	Token  string // form token; the page body is unreadable cross-origin
}

// scopeDescriptions explains each supported scope on the consent page.
var scopeDescriptions = map[string]string{
	ScopeOpenID:      "Confirm which account you are signed in with",
	ScopeRead:        "Read and change your workouts, routines, plans, bodyweight and settings",
	"offline_access": "Stay connected for up to 30 days without asking again",
}

func randomToken(n int) (string, error) {
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// beginConsent stores the request under a new one-shot key bound to u and
// sends the browser to the approval page.
func (s *Server) beginConsent(w http.ResponseWriter, r *http.Request, u *store.User, pending loginPending) {
	key, err := randomToken(24)
	if err != nil {
		http.Error(w, "server_error", http.StatusInternalServerError)
		return
	}
	token, err := randomToken(24)
	if err != nil {
		http.Error(w, "server_error", http.StatusInternalServerError)
		return
	}
	pending.Exp = time.Now().Add(loginTTL)
	now := time.Now()
	s.mu.Lock()
	for k, c := range s.consents {
		if now.After(c.Exp) {
			delete(s.consents, k)
		}
	}
	s.consents[key] = consentPending{loginPending: pending, UserID: u.ID, Token: token}
	s.mu.Unlock()
	http.Redirect(w, r, "/oauth/consent?state="+url.QueryEscape(key), http.StatusFound)
}

// consentFor returns the live request for key when it belongs to the signed-in user.
func (s *Server) consentFor(r *http.Request, key string) (consentPending, *store.User, bool) {
	s.mu.Lock()
	pending, ok := s.consents[key]
	s.mu.Unlock()
	if !ok || time.Now().After(pending.Exp) {
		return consentPending{}, nil, false
	}
	u := s.sessionUser(r)
	if u == nil || u.ID != pending.UserID {
		return consentPending{}, nil, false
	}
	return pending, u, true
}

func setConsentHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	// same-origin keeps the request key out of cross-origin Referer headers while
	// the approval form still sends a real Origin for CrossOriginProtection.
	h.Set("Referrer-Policy", "same-origin")
	h.Set("X-Frame-Options", "DENY")
	// No form-action: browsers apply it to the approval's redirect to the client.
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
}

// GET /oauth/consent — show who is asking, where the code goes, and what it grants.
func (s *Server) consentPage(w http.ResponseWriter, r *http.Request) {
	setConsentHeaders(w)
	key := r.URL.Query().Get("state")
	pending, u, ok := s.consentFor(r, key)
	if !ok {
		http.Error(w, "Authorization expired; start again from the app", http.StatusBadRequest)
		return
	}
	client, err := s.ST.OAuthClientByID(pending.ClientID)
	if err != nil || client == nil {
		http.Error(w, "invalid_request: unknown client", http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(client.ClientName)
	if name == "" {
		name = "An unnamed application"
	}
	destination := pending.RedirectURI
	if parsed, err := url.Parse(pending.RedirectURI); err == nil && parsed.Host != "" {
		destination = parsed.Scheme + "://" + parsed.Host
	}
	account := u.Name
	if account == "" {
		account = u.ID
	}
	product := html.EscapeString(s.Cfg.RPName)

	var b strings.Builder
	b.WriteString(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`)
	b.WriteString(`<title>Allow access — ` + product + `</title>`)
	b.WriteString(`<style>
body{font-family:system-ui,sans-serif;background:#0b0d10;color:#f4f6f8;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
main{max-width:24rem;padding:2rem}
h1{font-size:1.25rem;font-weight:600;margin:0 0 .75rem}
p,li{color:#9aa3ad;font-size:.875rem;line-height:1.4}
strong,code{color:#f4f6f8;word-break:break-all}
ul{padding-left:1.25rem;margin:0 0 1.5rem}
form{display:flex;gap:.5rem}
button{flex:1;padding:.75rem 1rem;border:0;border-radius:.5rem;font:inherit;font-weight:500;cursor:pointer}
.allow{background:#2563eb;color:#fff}
.deny{background:#1f242b;color:#f4f6f8}
</style></head><body><main>`)
	b.WriteString(`<h1>Allow <strong>` + html.EscapeString(name) + `</strong> to use your ` + product + ` account?</h1>`)
	b.WriteString(`<p>Signed in as <strong>` + html.EscapeString(account) + `</strong>. Access will be sent to <code>` + html.EscapeString(destination) + `</code>. Only continue if you started this connection yourself.</p>`)
	b.WriteString(`<p>This application will be able to:</p><ul>`)
	for scope := range strings.FieldsSeq(pending.Scope) {
		description, known := scopeDescriptions[scope]
		if !known {
			description = "Use the permission “" + scope + "”"
		}
		b.WriteString(`<li>` + html.EscapeString(description) + `</li>`)
	}
	b.WriteString(`</ul><form method="post" action="/oauth/consent">`)
	b.WriteString(`<input type="hidden" name="state" value="` + html.EscapeString(key) + `">`)
	b.WriteString(`<input type="hidden" name="token" value="` + html.EscapeString(pending.Token) + `">`)
	b.WriteString(`<button class="deny" type="submit" name="decision" value="deny">Deny</button>`)
	b.WriteString(`<button class="allow" type="submit" name="decision" value="allow">Allow</button>`)
	b.WriteString(`</form></main></body></html>`)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(b.String()))
}

// POST /oauth/consent — issue the code on approval, or return access_denied.
// The router wraps it in http.CrossOriginProtection.
func (s *Server) consentDecision(w http.ResponseWriter, r *http.Request) {
	setConsentHeaders(w)
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid_request", http.StatusBadRequest)
		return
	}
	key := r.PostForm.Get("state")
	pending, u, ok := s.consentFor(r, key)
	if !ok || subtle.ConstantTimeCompare([]byte(pending.Token), []byte(r.PostForm.Get("token"))) != 1 {
		http.Error(w, "Authorization expired; start again from the app", http.StatusBadRequest)
		return
	}
	// Only the request that removes the entry may answer, so a double submit
	// cannot mint two codes.
	s.mu.Lock()
	_, live := s.consents[key]
	delete(s.consents, key)
	s.mu.Unlock()
	if !live {
		http.Error(w, "Authorization expired; start again from the app", http.StatusBadRequest)
		return
	}

	if r.PostForm.Get("decision") != "allow" {
		s.clientRedirect(w, r, pending.RedirectURI, pending.State, "error", "access_denied")
		return
	}
	s.issueCodeRedirect(w, r, u, pending.ClientID, pending.RedirectURI, pending.State,
		pending.CodeChallenge, pending.CodeChallengeMethod, pending.Scope, pending.Resource)
}
