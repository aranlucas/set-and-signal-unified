package oauth

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json/v2"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

// POST /oauth/register — RFC 7591 Dynamic Client Registration (public clients).
func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_client_metadata", "bad body")
		return
	}
	var meta struct {
		RedirectURIs            []string `json:"redirect_uris"`
		ClientName              string   `json:"client_name"`
		TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
		GrantTypes              []string `json:"grant_types"`
		ResponseTypes           []string `json:"response_types"`
		Scope                   string   `json:"scope"`
	}
	if err := json.Unmarshal(body, &meta); err != nil {
		writeOAuthError(w, http.StatusBadRequest, "invalid_client_metadata", "invalid json")
		return
	}
	if len(meta.RedirectURIs) == 0 {
		writeOAuthError(w, http.StatusBadRequest, "invalid_redirect_uri", "redirect_uris required")
		return
	}
	for _, u := range meta.RedirectURIs {
		if u == "" || strings.Contains(u, " ") {
			writeOAuthError(w, http.StatusBadRequest, "invalid_redirect_uri", "invalid redirect_uri")
			return
		}
	}
	authMethod := meta.TokenEndpointAuthMethod
	if authMethod == "" {
		authMethod = "none"
	}
	grants := meta.GrantTypes
	if len(grants) == 0 {
		grants = []string{"authorization_code", "refresh_token"}
	}
	if !slices.Contains(grants, "authorization_code") {
		writeOAuthError(w, http.StatusBadRequest, "invalid_client_metadata", "authorization_code required")
		return
	}

	idRaw := make([]byte, 16)
	if _, err := rand.Read(idRaw); err != nil {
		writeOAuthError(w, http.StatusInternalServerError, "server_error", "rng failed")
		return
	}
	clientID := "ogc_" + base64.RawURLEncoding.EncodeToString(idRaw)

	var secret, secretHash string
	if authMethod != "none" {
		secRaw := make([]byte, 24)
		if _, err := rand.Read(secRaw); err != nil {
			writeOAuthError(w, http.StatusInternalServerError, "server_error", "rng failed")
			return
		}
		secret = base64.RawURLEncoding.EncodeToString(secRaw)
		secretHash = hashSecret(secret)
	}

	c := store.OAuthClient{
		ClientID:                clientID,
		ClientSecretHash:        secretHash,
		ClientName:              meta.ClientName,
		RedirectURIs:            meta.RedirectURIs,
		GrantTypes:              grants,
		TokenEndpointAuthMethod: authMethod,
		Created:                 time.Now().UTC().Format(time.RFC3339),
	}
	if err := s.ST.SaveOAuthClient(c); err != nil {
		writeOAuthError(w, http.StatusInternalServerError, "server_error", "persist failed")
		return
	}

	writeJSON(w, http.StatusCreated, struct {
		ClientID                string   `json:"client_id"`
		ClientIDIssuedAt        int64    `json:"client_id_issued_at"`
		RedirectURIs            []string `json:"redirect_uris"`
		GrantTypes              []string `json:"grant_types"`
		ResponseTypes           []string `json:"response_types"`
		TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
		ClientName              string   `json:"client_name"`
		ClientSecret            string   `json:"client_secret,omitempty"`
	}{
		ClientID: clientID, ClientIDIssuedAt: time.Now().Unix(), RedirectURIs: meta.RedirectURIs,
		GrantTypes: grants, ResponseTypes: []string{"code"}, TokenEndpointAuthMethod: authMethod,
		ClientName: meta.ClientName, ClientSecret: secret,
	})
}
