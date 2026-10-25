package oauth

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"
	"time"

	mcpauth "github.com/modelcontextprotocol/go-sdk/auth"

	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

// POST /oauth/token — authorization_code + refresh_token grants.
func (s *Server) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_request", "bad form")
		return
	}
	grant := r.FormValue("grant_type")
	clientID, clientSecret := s.clientAuth(r)

	switch grant {
	case "authorization_code":
		s.tokenAuthCode(w, r, clientID, clientSecret)
	case "refresh_token":
		s.tokenRefresh(w, r, clientID, clientSecret)
	default:
		writeOAuthError(w, http.StatusBadRequest, "unsupported_grant_type", grant)
	}
}

func (s *Server) clientAuth(r *http.Request) (id, secret string) {
	id = r.FormValue("client_id")
	secret = r.FormValue("client_secret")
	if u, p, ok := r.BasicAuth(); ok {
		if id == "" {
			id = u
		}
		if secret == "" {
			secret = p
		}
	}
	return id, secret
}

func (s *Server) tokenAuthCode(w http.ResponseWriter, r *http.Request, clientID, clientSecret string) {
	code := r.FormValue("code")
	redirectURI := r.FormValue("redirect_uri")
	verifier := r.FormValue("code_verifier")
	if code == "" || redirectURI == "" || verifier == "" || clientID == "" {
		writeOAuthError(w, http.StatusBadRequest, "invalid_request", "missing fields")
		return
	}
	client, err := s.ST.OAuthClientByID(clientID)
	if err != nil || client == nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_client", "unknown client")
		return
	}
	if !s.checkClientSecret(client, clientSecret) {
		writeOAuthError(w, http.StatusUnauthorized, "invalid_client", "bad secret")
		return
	}

	stored, err := s.ST.TakeOAuthCode(hashSecret(code))
	if err != nil {
		writeOAuthError(w, http.StatusInternalServerError, "server_error", "db")
		return
	}
	if stored == nil || time.Now().Unix() > stored.Exp {
		writeOAuthError(w, http.StatusBadRequest, "invalid_grant", "code expired or used")
		return
	}
	if stored.ClientID != clientID || stored.RedirectURI != redirectURI {
		writeOAuthError(w, http.StatusBadRequest, "invalid_grant", "mismatch")
		return
	}
	if pkceS256(verifier) != stored.CodeChallenge {
		writeOAuthError(w, http.StatusBadRequest, "invalid_grant", "pkce failed")
		return
	}

	s.writeTokenResponse(w, stored.UserID, clientID, stored.Scope, stored.Resource)
}

func (s *Server) tokenRefresh(w http.ResponseWriter, r *http.Request, clientID, clientSecret string) {
	refresh := r.FormValue("refresh_token")
	if refresh == "" || clientID == "" {
		writeOAuthError(w, http.StatusBadRequest, "invalid_request", "missing fields")
		return
	}
	client, err := s.ST.OAuthClientByID(clientID)
	if err != nil || client == nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_client", "unknown client")
		return
	}
	if !s.checkClientSecret(client, clientSecret) {
		writeOAuthError(w, http.StatusUnauthorized, "invalid_client", "bad secret")
		return
	}
	stored, err := s.ST.TakeOAuthRefresh(hashSecret(refresh))
	if err != nil {
		writeOAuthError(w, http.StatusInternalServerError, "server_error", "db")
		return
	}
	if stored == nil || time.Now().Unix() > stored.Exp || stored.ClientID != clientID {
		writeOAuthError(w, http.StatusBadRequest, "invalid_grant", "refresh invalid")
		return
	}
	s.writeTokenResponse(w, stored.UserID, clientID, stored.Scope, stored.Resource)
}

func (s *Server) checkClientSecret(c *store.OAuthClient, secret string) bool {
	if c.TokenEndpointAuthMethod == "none" || c.ClientSecretHash == "" {
		return true
	}
	return secret != "" && hashSecret(secret) == c.ClientSecretHash
}

func (s *Server) writeTokenResponse(w http.ResponseWriter, userID, clientID, scope, resource string) {
	access, exp, err := s.mintAccessToken(userID, clientID, scope, resource)
	if err != nil {
		writeOAuthError(w, http.StatusInternalServerError, "server_error", "mint failed")
		return
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		writeOAuthError(w, http.StatusInternalServerError, "server_error", "rng")
		return
	}
	refresh := base64.RawURLEncoding.EncodeToString(raw)
	if err := s.ST.SaveOAuthRefresh(store.OAuthRefresh{
		TokenHash: hashSecret(refresh),
		ClientID:  clientID,
		UserID:    userID,
		Scope:     scope,
		Resource:  resource,
		Exp:       time.Now().Add(refreshTTL).Unix(),
	}); err != nil {
		writeOAuthError(w, http.StatusInternalServerError, "server_error", "persist refresh token")
		return
	}

	writeJSON(w, http.StatusOK, struct {
		AccessToken  string `json:"access_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int    `json:"expires_in"`
		RefreshToken string `json:"refresh_token"`
		Scope        string `json:"scope"`
	}{
		AccessToken: access, TokenType: "Bearer", ExpiresIn: int(time.Until(exp).Seconds()),
		RefreshToken: refresh, Scope: scope,
	})
}

// VerifyBearer validates an OAuth access token for the MCP resource server.
// Returns mcpauth.TokenInfo suitable for RequireBearerToken.
func (s *Server) VerifyBearer(token string) (*mcpauth.TokenInfo, error) {
	claims, err := s.parseAccessToken(token)
	if err != nil {
		return nil, mcpauth.ErrInvalidToken
	}
	if claims.Resource != "" && claims.Resource != s.ResourceURI() {
		return nil, mcpauth.ErrInvalidToken
	}
	u, err := s.ST.UserByID(claims.Subject)
	if err != nil || u == nil || u.Disabled {
		return nil, mcpauth.ErrInvalidToken
	}
	scopes := strings.Fields(claims.Scope)
	return &mcpauth.TokenInfo{
		UserID:     claims.Subject,
		Scopes:     scopes,
		Expiration: claims.ExpiresAt.Time,
	}, nil
}
