// Package garmin connects the product account to the existing Garmin module.
// OAuth2 and MCP libraries own their protocols; no upstream Garmin credential is
// copied here. Only the user's scoped connector grant is retained, encrypted.
package garmin

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"database/sql"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"uuid"

	"github.com/aranlucas/set-and-signal-unified/internal/store"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"golang.org/x/oauth2"
)

var ErrDisconnected = errors.New("connect Garmin to continue")
var ErrUnavailable = errors.New("Garmin is unavailable; reconnect or try again later")

type Service struct {
	st                         *store.Store
	box                        cipher.AEAD
	issuer, resource, callback string
	client                     *http.Client
	locks                      sync.Map
}

type grant struct {
	Token    *oauth2.Token
	ClientID string
	GarminID string
}
type pending struct {
	UID      string
	Version  int
	Verifier string
	Expires  time.Time
	ClientID string
}

func New(st *store.Store, secret []byte, issuer, resource, publicURL string) (*Service, error) {
	for _, endpoint := range []string{issuer, resource, publicURL} {
		u, err := url.Parse(endpoint)
		if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))) {
			return nil, errors.New("invalid Garmin integration URL")
		}
	}
	key := sha256.Sum256(append([]byte("set-and-signal/garmin/v1:"), secret...))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	box, err := cipher.NewGCMWithRandomNonce(block)
	if err != nil {
		return nil, err
	}
	return &Service{st: st, box: box, issuer: strings.TrimRight(issuer, "/"), resource: resource, callback: strings.TrimRight(publicURL, "/") + "/api/garmin/callback", client: &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (s *Service) lock(key string) func() {
	value, _ := s.locks.LoadOrStore(key, new(sync.Mutex))
	mu := value.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

func (s *Service) save(key string, value any, owner string) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	sealed := s.box.Seal(nil, nil, raw, []byte(key))
	var ownerID *string
	if owner != "" {
		ownerID = new(owner)
	}
	_, err = s.st.DB.Exec("INSERT INTO integration_state(key,value,owner) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,owner=excluded.owner", key, sealed, ownerID)
	return err
}

func (s *Service) read(key string, value any, consume bool) error {
	var sealed []byte
	query := "SELECT value FROM integration_state WHERE key=?"
	if consume {
		query = "DELETE FROM integration_state WHERE key=? RETURNING value"
	}
	if err := s.st.DB.QueryRow(query, key).Scan(&sealed); err != nil {
		return err
	}
	raw, err := s.box.Open(nil, nil, sealed, []byte(key))
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, value)
}

func (s *Service) config(clientID string) oauth2.Config {
	return oauth2.Config{ClientID: clientID, RedirectURL: s.callback, Scopes: []string{"garmin:access", "offline_access"}, Endpoint: oauth2.Endpoint{AuthURL: s.issuer + "/oauth2/authorize", TokenURL: s.issuer + "/oauth2/token", AuthStyle: oauth2.AuthStyleInParams}}
}

func (s *Service) Begin(ctx context.Context, user store.User) (string, error) {
	unlock := s.lock("client")
	defer unlock()
	var registration struct {
		ClientID string `json:"client_id"`
	}
	if err := s.read("client", &registration, false); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		metadata := struct {
			Name      string   `json:"client_name"`
			Redirects []string `json:"redirect_uris"`
			Method    string   `json:"token_endpoint_auth_method"`
			Grants    []string `json:"grant_types"`
			Responses []string `json:"response_types"`
			Scope     string   `json:"scope"`
		}{"Set & Signal", []string{s.callback}, "none", []string{"authorization_code", "refresh_token"}, []string{"code"}, "garmin:access offline_access"}
		body, _ := json.Marshal(metadata)
		req, err := http.NewRequestWithContext(ctx, "POST", s.issuer+"/oauth2/register", strings.NewReader(string(body)))
		if err != nil {
			return "", err
		}
		req.Header.Set("Content-Type", "application/json")
		response, err := s.client.Do(req)
		if err != nil {
			return "", ErrUnavailable
		}
		defer response.Body.Close()
		if response.StatusCode != 201 && response.StatusCode != 200 {
			return "", ErrUnavailable
		}
		if err := json.UnmarshalRead(io.LimitReader(response.Body, 1<<20), &registration); err != nil || registration.ClientID == "" {
			return "", ErrUnavailable
		}
		if err := s.save("client", registration, ""); err != nil {
			return "", err
		}
	}
	state := uuid.New().String()
	verifier := oauth2.GenerateVerifier()
	if err := s.save("oauth/"+state, pending{UID: user.ID, Version: user.SV, Verifier: verifier, Expires: time.Now().Add(10 * time.Minute), ClientID: registration.ClientID}, user.ID); err != nil {
		return "", err
	}
	cfg := s.config(registration.ClientID)
	return cfg.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier), oauth2.SetAuthURLParam("resource", s.resource)), nil
}

func (s *Service) Finish(ctx context.Context, state, code string) error {
	var request pending
	if err := s.read("oauth/"+state, &request, true); err != nil || time.Now().After(request.Expires) || code == "" {
		return errors.New("Garmin connection expired; start again")
	}
	user, err := s.st.UserByID(request.UID)
	if err != nil || user == nil || user.Disabled || user.SV != request.Version {
		return ErrDisconnected
	}
	cfg := s.config(request.ClientID)
	ctx = context.WithValue(ctx, oauth2.HTTPClient, s.client)
	token, err := cfg.Exchange(ctx, code, oauth2.VerifierOption(request.Verifier), oauth2.SetAuthURLParam("resource", s.resource))
	if err != nil {
		return ErrUnavailable
	}
	// The connector validates the grant and the current Garmin link. An arbitrary
	// Auth identity token cannot pass this resource read.
	session, err := s.session(ctx, token)
	if err != nil {
		return ErrUnavailable
	}
	defer session.Close()
	account, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: "garmin://account"})
	if err != nil || account == nil || len(account.Contents) != 1 {
		return ErrUnavailable
	}
	var identity struct {
		UserID string `json:"userId"`
	}
	if err := json.Unmarshal([]byte(account.Contents[0].Text), &identity); err != nil || identity.UserID == "" {
		return ErrUnavailable
	}
	unlock := s.lock(request.UID)
	defer unlock()
	return s.save("grant/"+request.UID, grant{Token: token, ClientID: request.ClientID, GarminID: identity.UserID}, request.UID)
}

func (s *Service) token(ctx context.Context, uid string) (*oauth2.Token, error) {
	unlock := s.lock(uid)
	defer unlock()
	user, err := s.st.UserByID(uid)
	if err != nil || user == nil || user.Disabled {
		return nil, ErrDisconnected
	}
	var connection grant
	if err := s.read("grant/"+uid, &connection, false); err != nil {
		return nil, ErrDisconnected
	}
	cfg := s.config(connection.ClientID)
	ctx = context.WithValue(ctx, oauth2.HTTPClient, s.client)
	token, err := cfg.TokenSource(ctx, connection.Token).Token()
	if err != nil {
		return nil, ErrDisconnected
	}
	if token.AccessToken != connection.Token.AccessToken || token.RefreshToken != connection.Token.RefreshToken {
		connection.Token = token
		if err := s.save("grant/"+uid, connection, uid); err != nil {
			return nil, err
		}
	}
	return token, nil
}

func (s *Service) session(ctx context.Context, token *oauth2.Token) (*mcp.ClientSession, error) {
	client := oauth2.NewClient(context.WithValue(ctx, oauth2.HTTPClient, s.client), oauth2.StaticTokenSource(token))
	client.Timeout = 30 * time.Second
	client.CheckRedirect = s.client.CheckRedirect
	return mcp.NewClient(&mcp.Implementation{Name: "Set & Signal", Version: "1.0.0"}, nil).Connect(ctx, &mcp.StreamableClientTransport{Endpoint: s.resource, HTTPClient: client, MaxRetries: -1, DisableStandaloneSSE: true, MaxEventSize: 10 << 20}, nil)
}

func (s *Service) Linked(uid string) bool {
	var connection grant
	return s.read("grant/"+uid, &connection, false) == nil
}

// Disconnect revokes this product's connector grant. Garmin's shared Auth
// account remains linked; the product retains no separate provider data cache.
func (s *Service) Disconnect(ctx context.Context, uid string) error {
	unlock := s.lock(uid)
	defer unlock()
	var connection grant
	if err := s.read("grant/"+uid, &connection, false); err == nil && connection.Token.RefreshToken != "" {
		values := url.Values{"token": {connection.Token.RefreshToken}, "client_id": {connection.ClientID}, "token_type_hint": {"refresh_token"}}
		req, err := http.NewRequestWithContext(ctx, "POST", s.issuer+"/oauth2/revoke", strings.NewReader(values.Encode()))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		response, err := s.client.Do(req)
		if err != nil {
			return ErrUnavailable
		}
		response.Body.Close()
		if response.StatusCode >= 400 {
			return ErrUnavailable
		}
	}
	_, err := s.st.DB.Exec("DELETE FROM integration_state WHERE key=?", "grant/"+uid)
	return err
}

func (s *Service) Call(ctx context.Context, uid, name string, args any) (jsontext.Value, error) {
	token, err := s.token(ctx, uid)
	if err != nil {
		return nil, err
	}
	session, err := s.session(ctx, token)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer session.Close()
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil || result == nil || result.IsError {
		return nil, ErrUnavailable
	}
	raw, err := json.Marshal(result.StructuredContent)
	if err != nil {
		return nil, err
	}
	var envelope struct {
		Data jsontext.Value `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil || len(envelope.Data) == 0 {
		return nil, fmt.Errorf("%w: unsupported connector response", ErrUnavailable)
	}
	return envelope.Data, nil
}
