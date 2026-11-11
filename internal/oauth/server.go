// Package oauth implements an OAuth 2.1 authorization server for the MCP
// resource, with OIDC federation (Google / GitHub / Apple) for the human login
// step. MCP clients (Grok, Cursor, …) discover us via Protected Resource
// Metadata, optionally register via DCR, then run Authorization Code + PKCE.
package oauth

import (
	"crypto/sha256"
	"encoding/hex"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/aranlucas/set-and-signal-unified/internal/auth"
	"github.com/aranlucas/set-and-signal-unified/internal/config"
	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

const (
	ScopeOpenID = "openid"
	ScopeRead   = "workset"
	ScopeAll    = "openid workset offline_access"

	codeTTL    = 5 * time.Minute
	accessTTL  = 1 * time.Hour
	refreshTTL = 30 * 24 * time.Hour
	loginTTL   = 10 * time.Minute
)

// Server is the authorization server + token verifier used by /mcp.
type Server struct {
	Cfg  config.Config
	ST   *store.Store
	Sess *auth.Sessions

	mu        sync.Mutex
	logins    map[string]loginPending   // state → pending authorize after IdP
	consents  map[string]consentPending // state → signed-in request awaiting approval
	providers map[string]Provider
}

type loginPending struct {
	ClientID            string
	RedirectURI         string
	State               string // client's state (returned to client)
	CodeChallenge       string
	CodeChallengeMethod string
	Scope               string
	Resource            string
	Exp                 time.Time
}

// New builds an AS bound to the given store and session signer.
func New(cfg config.Config, st *store.Store, sess *auth.Sessions) *Server {
	s := &Server{
		Cfg:       cfg,
		ST:        st,
		Sess:      sess,
		logins:    map[string]loginPending{},
		consents:  map[string]consentPending{},
		providers: map[string]Provider{},
	}
	for _, p := range configuredProviders(cfg) {
		s.providers[p.ID()] = p
	}
	return s
}

// Enabled is true when at least one OIDC provider is configured.
func (s *Server) Enabled() bool {
	return len(s.providers) > 0
}

// ProviderIDs returns configured IdP ids (google, github, apple).
func (s *Server) ProviderIDs() []string {
	return slices.Sorted(maps.Keys(s.providers))
}

// Issuer is the AS issuer URL (same origin as the API).
func (s *Server) Issuer() string {
	return strings.TrimRight(s.Cfg.PublicURL, "/")
}

// ResourceURI is the MCP protected-resource identifier.
func (s *Server) ResourceURI() string {
	return s.Issuer() + "/mcp"
}

// ResourceMetadataURL is the RFC 9728 document URL.
func (s *Server) ResourceMetadataURL() string {
	return s.Issuer() + "/.well-known/oauth-protected-resource"
}

// Mount registers AS + PRM routes on the chi mux (no auth middleware).
func (s *Server) Mount(r chi.Router) {
	r.Get("/.well-known/oauth-protected-resource", s.protectedResourceMetadata)
	r.Get("/.well-known/oauth-authorization-server", s.authorizationServerMetadata)
	// Path-aware PRM variants some clients probe (RFC 9728 §3).
	r.Get("/.well-known/oauth-protected-resource/mcp", s.protectedResourceMetadata)

	r.Post("/oauth/register", s.register)
	r.Get("/oauth/authorize", s.authorize)
	r.Get("/oauth/login", s.loginPage)
	r.Get("/oauth/resume", s.resumeSession)
	r.Get("/oauth/consent", s.consentPage)
	r.Method(http.MethodPost, "/oauth/consent", http.NewCrossOriginProtection().Handler(http.HandlerFunc(s.consentDecision)))
	r.Get("/oauth/web/{provider}", s.webLoginStart)
	r.Get("/oauth/callback/{provider}", s.oidcCallback)
	r.Post("/oauth/token", s.token)
}

func hashSecret(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func (s *Server) setSessionCookie(w http.ResponseWriter, u *store.User) {
	val, maxAge := s.Sess.Make(u.ID, u.SV)
	secure := ""
	if strings.HasPrefix(s.Cfg.PublicURL, "https:") {
		secure = " Secure;"
	}
	w.Header().Add("Set-Cookie",
		"gymsid="+val+"; Path=/; Max-Age="+strconv.Itoa(maxAge)+"; HttpOnly;"+secure+" SameSite=Lax")
}

// sessionUser reads the gymsid cookie if present and valid.
func (s *Server) sessionUser(r *http.Request) *store.User {
	ck, err := r.Cookie("gymsid")
	if err != nil || ck.Value == "" {
		return nil
	}
	uid, ok := s.Sess.Read(ck.Value, func(uid string) (int, bool) {
		u, err := s.ST.UserByID(uid)
		if err != nil || u == nil {
			return 0, true
		}
		return u.SV, u.Disabled
	})
	if !ok {
		return nil
	}
	u, err := s.ST.UserByID(uid)
	if err != nil || u == nil || u.Disabled {
		return nil
	}
	return u
}
