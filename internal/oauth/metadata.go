package oauth

import (
	"encoding/json/v2"
	"net/http"
)

func (s *Server) protectedResourceMetadata(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, struct {
		Resource               string   `json:"resource"`
		AuthorizationServers   []string `json:"authorization_servers"`
		ScopesSupported        []string `json:"scopes_supported"`
		BearerMethodsSupported []string `json:"bearer_methods_supported"`
		ResourceName           string   `json:"resource_name"`
	}{
		Resource: s.ResourceURI(), AuthorizationServers: []string{s.Issuer()},
		ScopesSupported:        []string{ScopeRead},
		BearerMethodsSupported: []string{"header"}, ResourceName: s.Cfg.RPName,
	})
}

func (s *Server) authorizationServerMetadata(w http.ResponseWriter, _ *http.Request) {
	iss := s.Issuer()
	writeJSON(w, http.StatusOK, struct {
		Issuer                            string   `json:"issuer"`
		AuthorizationEndpoint             string   `json:"authorization_endpoint"`
		TokenEndpoint                     string   `json:"token_endpoint"`
		RegistrationEndpoint              string   `json:"registration_endpoint"`
		ResponseTypesSupported            []string `json:"response_types_supported"`
		GrantTypesSupported               []string `json:"grant_types_supported"`
		CodeChallengeMethodsSupported     []string `json:"code_challenge_methods_supported"`
		TokenEndpointAuthMethodsSupported []string `json:"token_endpoint_auth_methods_supported"`
		ScopesSupported                   []string `json:"scopes_supported"`
		SubjectTypesSupported             []string `json:"subject_types_supported"`
	}{
		Issuer: iss, AuthorizationEndpoint: iss + "/oauth/authorize",
		TokenEndpoint: iss + "/oauth/token", RegistrationEndpoint: iss + "/oauth/register",
		ResponseTypesSupported:            []string{"code"},
		GrantTypesSupported:               []string{"authorization_code", "refresh_token"},
		CodeChallengeMethodsSupported:     []string{"S256"},
		TokenEndpointAuthMethodsSupported: []string{"none", "client_secret_post", "client_secret_basic"},
		ScopesSupported:                   []string{ScopeOpenID, ScopeRead, "offline_access"},
		SubjectTypesSupported:             []string{"public"},
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		status = http.StatusInternalServerError
		body = []byte(`{"error":"server_error","error_description":"server error"}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func writeOAuthError(w http.ResponseWriter, status int, code, desc string) {
	writeJSON(w, status, map[string]string{
		"error":             code,
		"error_description": desc,
	})
}
