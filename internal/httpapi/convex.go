package httpapi

import "net/http"

func (s *Server) convexToken(w http.ResponseWriter, r *http.Request) {
	user := s.requireAnyAuth(w, r)
	if user == nil {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if s.Convex == nil {
		writeErr(w, http.StatusServiceUnavailable, "Convex is not configured")
		return
	}
	token, err := s.Convex.Token(user.ID, false)
	if err != nil {
		serverError(w)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Token  string `json:"token"`
		URL    string `json:"url"`
		UserID string `json:"userId"`
	}{Token: token, URL: s.Convex.URL, UserID: user.ID})
}
func (s *Server) convexJWKS(w http.ResponseWriter, _ *http.Request) {
	if s.Convex == nil {
		writeErr(w, http.StatusServiceUnavailable, "Convex is not configured")
		return
	}
	writeJSON(w, http.StatusOK, s.Convex.JWKS())
}
