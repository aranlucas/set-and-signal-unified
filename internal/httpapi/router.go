package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/aranlucas/set-and-signal-unified/internal/ai"
	"github.com/aranlucas/set-and-signal-unified/internal/auth"
	"github.com/aranlucas/set-and-signal-unified/internal/config"
	"github.com/aranlucas/set-and-signal-unified/internal/convex"
	"github.com/aranlucas/set-and-signal-unified/internal/garmin"
	"github.com/aranlucas/set-and-signal-unified/internal/oauth"
	"github.com/aranlucas/set-and-signal-unified/internal/presence"
	"github.com/aranlucas/set-and-signal-unified/internal/push"
	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

// Server carries every dependency the handlers need.
type Server struct {
	Cfg      config.Config
	Convex   *convex.Client
	ST       *store.Store
	Sess     *auth.Sessions
	WA       *auth.WebAuthn
	Push     *push.Service
	Presence *presence.Presence
	AI       *ai.Client
	OAuth    *oauth.Server
	Garmin   *garmin.Service

	mcpOnce sync.Once
	mcpSrv  *mcp.Server
}

// Router builds the chi mux with the exact upstream route table
// (server.js lines 379–855).
func Router(s *Server) http.Handler {
	r := chi.NewRouter()
	r.Use(s.resolveCaller)

	r.Get("/api/health", s.health)
	r.Get("/api/config", s.config)
	r.Get("/api/me", s.me)
	r.Get("/api/convex/token", s.convexToken)
	r.Get("/api/convex/jwks", s.convexJWKS)

	r.Post("/api/register/options", s.registerOptions)
	r.Post("/api/register/verify", s.registerVerify)
	r.Post("/api/login/options", s.loginOptions)
	r.Post("/api/login/verify", s.loginVerify)
	r.Post("/api/logout", s.logout)
	r.Post("/api/logout/all", s.logoutAll)

	r.Get("/api/data", s.getData)
	r.Get("/api/native/me", s.nativeIdentity)
	r.Post("/api/workout/import", s.importWorkout)
	r.Post("/api/workout/finalize", s.finalizeWorkout)
	r.Get("/api/garmin/status", s.garminStatus)
	r.Post("/api/garmin/connect", s.garminConnect)
	r.Get("/api/garmin/callback", s.garminCallback)
	r.Post("/api/garmin/disconnect", s.garminDisconnect)
	r.Get("/api/garmin/day", s.garminDay)
	r.Get("/api/garmin/activity", s.garminActivity)
	r.Post("/api/garmin/workout", s.garminPublish)

	r.Post("/api/routine", s.postRoutine)
	r.Post("/api/routines", s.postRoutines)
	r.Post("/api/routine/delete", s.deleteRoutine)
	r.Post("/api/week", s.postWeek)
	r.Post("/api/dayplan", s.postDayPlan)
	r.Post("/api/bodyweight", s.postBodyweight)
	r.Post("/api/settings", s.postSettings)

	r.Post("/api/activity", s.postActivity)

	r.Get("/api/push/public-key", s.pushPublicKey)
	r.Post("/api/push/subscribe", s.postPushSubscribe)
	r.Post("/api/push/unsubscribe", s.postPushUnsubscribe)
	r.Post("/api/push/test", s.postPushTest)
	r.Post("/api/push/rest-timer", s.postRestTimer)
	r.Post("/api/push/rest-timer/cancel", s.postRestTimerCancel)

	r.Get("/api/admin/users", s.adminUsers)
	r.Get("/api/admin/user", s.adminUser)
	r.Post("/api/admin/user/disable", s.adminDisable)
	r.Get("/api/admin/invites", s.adminInvites)
	r.Post("/api/admin/invites/new", s.adminNewInvite)
	r.Post("/api/admin/invites/revoke", s.adminRevokeInvite)

	r.Get("/api/ai/status", s.aiStatus)
	r.Post("/api/ai/next-workout", s.postAINextWorkout)

	// OAuth 2.1 AS + Protected Resource Metadata (MCP / Grok discovery).
	if s.OAuth != nil {
		s.OAuth.Mount(r)
	}

	// MCP over streamable HTTP: POST/GET/DELETE are dispatched inside the
	// SDK handler; bearer-token auth is enforced before it.
	mcpH := s.mcpHandler()
	r.Method(http.MethodPost, "/mcp", mcpH)
	r.Method(http.MethodGet, "/mcp", mcpH)
	r.Method(http.MethodDelete, "/mcp", mcpH)

	notFound := func(w http.ResponseWriter, _ *http.Request) { writeErr(w, http.StatusNotFound, "not found") }
	r.NotFound(notFound)
	r.MethodNotAllowed(notFound)
	return r
}

// ---------- caller resolution ----------

type callerKey struct{}

// caller is the resolved request identity. viaCookie distinguishes cookie
// sessions from OAuth bearer tokens: /api/me, logout/all and
// the admin surface stay cookie-only.
type caller struct {
	user      *store.User
	viaCookie bool
}

func callerOf(r *http.Request) *caller {
	c, _ := r.Context().Value(callerKey{}).(*caller)
	return c
}

// resolveCaller resolves the caller once per request and stores it in the
// request context; handlers pick their guard (session / any / admin).
func (s *Server) resolveCaller(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c := s.resolve(r); c != nil {
			r = r.WithContext(context.WithValue(r.Context(), callerKey{}, c))
		}
		next.ServeHTTP(w, r)
	})
}

// resolve mirrors upstream auth(req): cookie session first, then bearer.
// Disabled accounts are locked out of both.
func (s *Server) resolve(r *http.Request) *caller {
	if ck, err := r.Cookie("gymsid"); err == nil && ck.Value != "" {
		if uid, ok := s.Sess.Read(ck.Value, s.sessionLookup); ok {
			if u := s.user(uid); u != nil {
				return &caller{user: u, viaCookie: true}
			}
		}
	}
	if secret := bearerToken(r); secret != "" && s.OAuth != nil {
		if ti, err := s.OAuth.VerifyBearer(secret); err == nil && ti != nil {
			if u := s.user(ti.UserID); u != nil {
				return &caller{user: u}
			}
		}
	}
	return nil
}

// sessionLookup feeds Sessions.Read: unknown users report disabled, like
// upstream's readSession nulling on a missing row.
func (s *Server) sessionLookup(uid string) (int, bool) {
	u, err := s.ST.UserByID(uid)
	if err != nil || u == nil {
		return 0, true
	}
	return u.SV, u.Disabled
}

func (s *Server) user(id string) *store.User {
	u, err := s.ST.UserByID(id)
	if err != nil || u == nil || u.Disabled {
		return nil
	}
	return u
}

var bearerRe = regexp.MustCompile(`^Bearer\s+(.+)$`)

func bearerToken(r *http.Request) string {
	m := bearerRe.FindStringSubmatch(r.Header.Get("Authorization"))
	if m == nil {
		return ""
	}
	return m[1]
}

// ---------- route guards ----------

func unauthorized(w http.ResponseWriter) { writeErr(w, http.StatusUnauthorized, "not signed in") }

// requireSession accepts only cookie sessions (upstream readSession).
func (s *Server) requireSession(w http.ResponseWriter, r *http.Request) *store.User {
	c := callerOf(r)
	if c == nil || !c.viaCookie {
		unauthorized(w)
		return nil
	}
	return c.user
}

// requireAnyAuth accepts cookie sessions or bearer tokens (upstream auth()).
func (s *Server) requireAnyAuth(w http.ResponseWriter, r *http.Request) *store.User {
	c := callerOf(r)
	if c == nil {
		unauthorized(w)
		return nil
	}
	return c.user
}

// requireAdmin gates /api/admin/*: session-only, like upstream's guard —
// 401 "not signed in", then 403 "forbidden" for non-admins.
func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) *store.User {
	c := callerOf(r)
	if c == nil || !c.viaCookie {
		unauthorized(w)
		return nil
	}
	if !s.isAdmin(c.user) {
		writeErr(w, http.StatusForbidden, "forbidden")
		return nil
	}
	return c.user
}

// isAdmin mirrors upstream: explicit flag or membership in ADMIN_UIDS.
func (s *Server) isAdmin(u *store.User) bool {
	return u.Admin || slices.Contains(s.Cfg.AdminUIDs, u.ID)
}

// userPayload is the {id,name,admin} shape every auth success returns.
func (s *Server) userPayload(u store.User) userPayload {
	return userPayload{ID: u.ID, Name: u.Name, Admin: s.isAdmin(&u)}
}

// ---------- cookies ----------

// setCookie builds the gymsid Set-Cookie header verbatim from server.js
// sessionCookie(): Path=/; Max-Age=days*86400; HttpOnly; Secure iff the
// origin is https; SameSite=Lax.
func (s *Server) setCookie(u *store.User) string {
	val, maxAge := s.Sess.Make(u.ID, u.SV)
	return fmt.Sprintf("gymsid=%s; Path=/; Max-Age=%d; HttpOnly;%s SameSite=Lax", val, maxAge, s.secureFlag())
}

// clearCookie expires the session cookie (server.js clearCookie).
func (s *Server) clearCookie() string {
	return fmt.Sprintf("gymsid=; Path=/; Max-Age=0; HttpOnly;%s SameSite=Lax", s.secureFlag())
}

func (s *Server) secureFlag() string {
	if strings.HasPrefix(s.Cfg.Origin, "https:") {
		return " Secure;"
	}
	return ""
}
