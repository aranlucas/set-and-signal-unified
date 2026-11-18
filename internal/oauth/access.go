package oauth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type accessClaims struct {
	Scope    string `json:"scope"`
	Resource string `json:"resource,omitempty"`
	ClientID string `json:"client_id"`
	jwt.RegisteredClaims
}

func (s *Server) mintAccessToken(userID, clientID, scope, resource string) (string, time.Time, error) {
	exp := time.Now().Add(accessTTL)
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims{
		Scope:     scope,
		Resource:  resource,
		ClientID:  clientID,
		Issuer:    s.Issuer(),
		Subject:   userID,
		Audience:  []string{s.ResourceURI()},
		ExpiresAt: jwt.NewNumericDate(exp),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
	})
	signed, err := tok.SignedString(s.Sess.Secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, exp, nil
}

// IssueAccessToken mints a short-lived access token for userID. Used by tests
// and any first-party caller that already authenticated the user.
func (s *Server) IssueAccessToken(userID string) (string, error) {
	tok, _, err := s.mintAccessToken(userID, "workset", ScopeAll, s.ResourceURI())
	return tok, err
}

func (s *Server) parseAccessToken(raw string) (*accessClaims, error) {
	tok, err := jwt.ParseWithClaims(raw, &accessClaims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected alg")
		}
		return s.Sess.Secret, nil
	}, jwt.WithAudience(s.ResourceURI()), jwt.WithIssuer(s.Issuer()), jwt.WithExpirationRequired())
	if err != nil {
		return nil, err
	}
	claims, ok := tok.Claims.(*accessClaims)
	if !ok || !tok.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}
