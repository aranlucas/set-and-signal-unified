// Package convex connects the Go identity/integration service to Convex training data.
package convex

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/store"
	"github.com/golang-jwt/jwt/v5"
)

type Client struct {
	URL, Issuer string
	key         *rsa.PrivateKey
	http        *http.Client
}

var _ store.TrainingBackend = (*Client)(nil)

// JSONWebKeySet is the public signing-key document consumed by Convex.
type JSONWebKeySet struct {
	Keys []JSONWebKey `json:"keys"`
}

type JSONWebKey struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type tokenClaims struct {
	jwt.RegisteredClaims
	Audience string `json:"aud"`
	Service  bool   `json:"service"`
}

// Convex's token contract uses a single string audience.
func (c tokenClaims) GetAudience() (jwt.ClaimStrings, error) {
	return jwt.ClaimStrings{c.Audience}, nil
}

func New(url, issuer, dir string) (*Client, error) {
	path := filepath.Join(dir, "convex-signing.pem")
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		key, e := rsa.GenerateKey(rand.Reader, 2048)
		if e != nil {
			return nil, e
		}
		raw = pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
		if e = os.WriteFile(path, raw, 0600); e != nil {
			return nil, e
		}
	} else if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, errors.New("invalid Convex signing key")
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	return &Client{URL: strings.TrimRight(url, "/"), Issuer: issuer, key: key, http: &http.Client{Timeout: 15 * time.Second}}, nil
}
func (c *Client) JWKS() JSONWebKeySet {
	return JSONWebKeySet{Keys: []JSONWebKey{{
		Kty: "RSA", Kid: "set-and-signal", Use: "sig", Alg: "RS256",
		N: base64.RawURLEncoding.EncodeToString(c.key.N.Bytes()), E: "AQAB",
	}}}
}
func (c *Client) Token(uid string, service bool) (string, error) {
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, tokenClaims{
		Issuer: c.Issuer, Audience: "set-and-signal", Subject: uid,
		IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(2 * time.Minute)),
		Service: service,
	})
	token.Header["kid"] = "set-and-signal"
	return token.SignedString(c.key)
}
func (c *Client) call[Args, Result any](uid, kind, path string, args Args, out *Result) error {
	token, err := c.Token(uid, true)
	if err != nil {
		return err
	}
	body, err := json.Marshal(struct {
		Path   string `json:"path"`
		Args   Args   `json:"args"`
		Format string `json:"format"`
	}{Path: path, Args: args, Format: "json"})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, c.URL+"/api/"+kind, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Convex HTTP %d", resp.StatusCode)
	}
	var envelope struct {
		Status       string         `json:"status"`
		Value        jsontext.Value `json:"value"`
		ErrorMessage string         `json:"errorMessage"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return err
	}
	if envelope.Status != "success" {
		return fmt.Errorf("Convex function failed: %s", envelope.ErrorMessage)
	}
	return json.Unmarshal(envelope.Value, out)
}
func (c *Client) ReadState(uid string) (jsontext.Value, error) {
	var value any
	if err := c.call(uid, "query", "training:snapshot", struct{}{}, &value); err != nil {
		return nil, err
	}
	// Convex serializes integral numbers as 1.0; the typed Go model expects 1.
	return json.Marshal(value)
}
func (c *Client) replace(uid string, raw jsontext.Value, expected *int64) (bool, error) {
	var ok bool
	err := c.call(uid, "mutation", "training:replace", struct {
		State    string `json:"state"`
		Expected *int64 `json:"expected"`
	}{State: string(raw), Expected: expected}, &ok)
	return ok, err
}
func (c *Client) WriteState(uid string, raw jsontext.Value) error {
	_, err := c.replace(uid, raw, nil)
	return err
}
func (c *Client) MutateState(uid string, fn func(jsontext.Value) (jsontext.Value, error)) error {
	for range 5 {
		raw, err := c.ReadState(uid)
		if err != nil {
			return err
		}
		var state struct {
			TS int64 `json:"_ts"`
		}
		if err := json.Unmarshal(raw, &state); err != nil {
			return err
		}
		next, err := fn(raw)
		if err != nil {
			return err
		}
		ok, err := c.replace(uid, next, &state.TS)
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
	}
	return errors.New("training data changed repeatedly; retry the operation")
}

func (c *Client) Summary(uid string) (store.TrainingSummary, error) {
	var value struct {
		Workouts    float64        `json:"workouts"`
		LastWorkout jsontext.Value `json:"lastWorkout"`
		LastSync    jsontext.Value `json:"lastSync"`
	}
	err := c.call(uid, "query", "training:summary", struct{}{}, &value)
	return store.TrainingSummary{Workouts: int(value.Workouts), LastWorkout: value.LastWorkout, LastSync: value.LastSync}, err
}
