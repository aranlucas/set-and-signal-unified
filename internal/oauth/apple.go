package oauth

import (
	"context"
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/oauth2"

	"github.com/aranlucas/set-and-signal-unified/internal/config"
)

type appleProvider struct {
	cfg config.Config
}

func newAppleProvider(cfg config.Config) Provider {
	return &appleProvider{cfg: cfg}
}

func (p *appleProvider) ID() string    { return "apple" }
func (p *appleProvider) Label() string { return "Apple" }

func (p *appleProvider) oauthCfg(redirectURI string) (oauth2.Config, error) {
	secret, err := appleClientSecret(p.cfg)
	if err != nil {
		return oauth2.Config{}, err
	}
	return oauth2.Config{
		ClientID:     p.cfg.AppleClientID,
		ClientSecret: secret,
		RedirectURL:  redirectURI,
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://appleid.apple.com/auth/authorize",
			TokenURL: "https://appleid.apple.com/auth/token",
		},
		Scopes: []string{"name", "email"},
	}, nil
}

func (p *appleProvider) AuthCodeURL(state, redirectURI string) (string, error) {
	cfg, err := p.oauthCfg(redirectURI)
	if err != nil {
		return "", err
	}
	// Apple prefers form_post for name/email; query keeps MCP browser flows simple.
	return cfg.AuthCodeURL(state, oauth2.SetAuthURLParam("response_mode", "query")), nil
}

func (p *appleProvider) Exchange(ctx context.Context, code, redirectURI string) (*UserInfo, error) {
	cfg, err := p.oauthCfg(redirectURI)
	if err != nil {
		return nil, err
	}
	tok, err := cfg.Exchange(ctx, code)
	if err != nil {
		return nil, err
	}
	raw, _ := tok.Extra("id_token").(string)
	if raw == "" {
		return nil, fmt.Errorf("apple: missing id_token")
	}
	parser := jwt.NewParser(jwt.WithoutClaimsValidation())
	claims := jwt.MapClaims{}
	if _, _, err := parser.ParseUnverified(raw, claims); err != nil {
		return nil, err
	}
	iss, _ := claims["iss"].(string)
	aud, _ := claims["aud"].(string)
	sub, _ := claims["sub"].(string)
	email, _ := claims["email"].(string)
	if iss != "https://appleid.apple.com" || aud != p.cfg.AppleClientID || sub == "" {
		return nil, fmt.Errorf("apple: invalid id_token claims")
	}
	name := email
	if name == "" {
		name = "Apple user"
	}
	return &UserInfo{Subject: sub, Email: email, Name: name}, nil
}

func appleClientSecret(cfg config.Config) (string, error) {
	block, _ := pem.Decode([]byte(trimPEM(cfg.ApplePrivateKey)))
	if block == nil {
		return "", fmt.Errorf("apple: invalid private key PEM")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", err
	}
	ecKey, ok := key.(*ecdsa.PrivateKey)
	if !ok {
		return "", fmt.Errorf("apple: expected EC private key")
	}
	now := time.Now()
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"iss": cfg.AppleTeamID,
		"iat": now.Unix(),
		"exp": now.Add(30 * time.Minute).Unix(),
		"aud": "https://appleid.apple.com",
		"sub": cfg.AppleClientID,
	})
	tok.Header["kid"] = cfg.AppleKeyID
	return tok.SignedString(ecKey)
}
