package oauth

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"io"
	"net/http"
	"strings"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"

	"github.com/aranlucas/set-and-signal-unified/internal/config"
)

// Provider is an upstream OIDC / OAuth IdP used only for human login.
type Provider interface {
	ID() string
	Label() string
	AuthCodeURL(state, redirectURI string) (string, error)
	Exchange(ctx context.Context, code, redirectURI string) (*UserInfo, error)
}

// UserInfo is the normalized profile from an IdP.
type UserInfo struct {
	Subject string
	Email   string
	Name    string
}

type oauthProvider struct {
	id, label string
	cfg       oauth2.Config
	userInfo  func(ctx context.Context, tok *oauth2.Token) (*UserInfo, error)
}

func (p *oauthProvider) ID() string    { return p.id }
func (p *oauthProvider) Label() string { return p.label }

func (p *oauthProvider) AuthCodeURL(state, redirectURI string) (string, error) {
	cfg := p.cfg
	cfg.RedirectURL = redirectURI
	return cfg.AuthCodeURL(state, oauth2.AccessTypeOnline), nil
}

func (p *oauthProvider) Exchange(ctx context.Context, code, redirectURI string) (*UserInfo, error) {
	cfg := p.cfg
	cfg.RedirectURL = redirectURI
	tok, err := cfg.Exchange(ctx, code)
	if err != nil {
		return nil, err
	}
	return p.userInfo(ctx, tok)
}

func configuredProviders(cfg config.Config) []Provider {
	var out []Provider
	if cfg.GoogleClientID != "" && cfg.GoogleClientSecret != "" {
		out = append(out, &oauthProvider{
			id:    "google",
			label: "Google",
			cfg: oauth2.Config{
				ClientID:     cfg.GoogleClientID,
				ClientSecret: cfg.GoogleClientSecret,
				Endpoint: oauth2.Endpoint{
					AuthURL:  "https://accounts.google.com/o/oauth2/auth",
					TokenURL: "https://oauth2.googleapis.com/token",
				},
				Scopes: []string{"openid", "email", "profile"},
			},
			userInfo: googleUserInfo,
		})
	}
	if cfg.GitHubClientID != "" && cfg.GitHubClientSecret != "" {
		out = append(out, &oauthProvider{
			id:    "github",
			label: "GitHub",
			cfg: oauth2.Config{
				ClientID:     cfg.GitHubClientID,
				ClientSecret: cfg.GitHubClientSecret,
				Endpoint:     github.Endpoint,
				Scopes:       []string{"read:user", "user:email"},
			},
			userInfo: githubUserInfo,
		})
	}
	// Apple Sign In needs a JWT client_secret; wire when APPLE_* is set.
	if cfg.AppleClientID != "" && cfg.AppleTeamID != "" && cfg.AppleKeyID != "" && cfg.ApplePrivateKey != "" {
		out = append(out, newAppleProvider(cfg))
	}
	return out
}

func googleUserInfo(ctx context.Context, tok *oauth2.Token) (*UserInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://openidconnect.googleapis.com/v1/userinfo", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("google userinfo %d: %s", resp.StatusCode, b)
	}
	var body struct {
		Sub   string `json:"sub"`
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := json.UnmarshalRead(resp.Body, &body); err != nil {
		return nil, err
	}
	if body.Sub == "" {
		return nil, fmt.Errorf("google userinfo missing sub")
	}
	return &UserInfo{Subject: body.Sub, Email: body.Email, Name: body.Name}, nil
}

func githubUserInfo(ctx context.Context, tok *oauth2.Token) (*UserInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("github user %d: %s", resp.StatusCode, b)
	}
	var body struct {
		ID    int64  `json:"id"`
		Login string `json:"login"`
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := json.UnmarshalRead(resp.Body, &body); err != nil {
		return nil, err
	}
	if body.ID == 0 {
		return nil, fmt.Errorf("github user missing id")
	}
	name := body.Name
	if name == "" {
		name = body.Login
	}
	email := body.Email
	if email == "" {
		email, _ = githubPrimaryEmail(ctx, tok.AccessToken)
	}
	return &UserInfo{
		Subject: fmt.Sprintf("%d", body.ID),
		Email:   email,
		Name:    name,
	}, nil
}

func githubPrimaryEmail(ctx context.Context, accessToken string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user/emails", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github emails %d", resp.StatusCode)
	}
	var emails []struct {
		Email   string `json:"email"`
		Primary bool   `json:"primary"`
	}
	if err := json.UnmarshalRead(resp.Body, &emails); err != nil {
		return "", err
	}
	for _, e := range emails {
		if e.Primary && e.Email != "" {
			return e.Email, nil
		}
	}
	if len(emails) > 0 {
		return emails[0].Email, nil
	}
	return "", nil
}

// trimPEM is used by Apple JWT client_secret generation.
func trimPEM(s string) string {
	return strings.ReplaceAll(strings.TrimSpace(s), `\n`, "\n")
}
