package garmin

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/store"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"golang.org/x/oauth2"
)

type fixture struct {
	service                       *Service
	user                          store.User
	issuer                        *httptest.Server
	creates, schedules, exchanges atomic.Int32
	failSchedule                  atomic.Bool
	verifier                      string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.DB.Close() })
	f := &fixture{user: store.User{ID: "alice"}}
	for _, id := range []string{"alice", "bob"} {
		if err := st.CreateUser(store.User{ID: id}); err != nil {
			t.Fatal(err)
		}
	}
	connector := mcp.NewServer(&mcp.Implementation{Name: "fake Garmin", Version: "1"}, nil)
	connector.AddResource(&mcp.Resource{URI: "garmin://account", Name: "account"}, func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: "garmin://account", Text: `{"userId":"garmin-alice"}`}}}, nil
	})
	connector.AddTool(&mcp.Tool{Name: "create_workout", InputSchema: map[string]any{"type": "object"}}, func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		f.creates.Add(1)
		return &mcp.CallToolResult{StructuredContent: map[string]any{"data": map[string]any{"workoutId": 123}}}, nil
	})
	connector.AddTool(&mcp.Tool{Name: "schedule_workout", InputSchema: map[string]any{"type": "object"}}, func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		f.schedules.Add(1)
		if f.failSchedule.Load() {
			return nil, errors.New("upstream response lost")
		}
		return &mcp.CallToolResult{StructuredContent: map[string]any{"data": map[string]any{"scheduleId": 456}}}, nil
	})
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return connector }, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth2/register", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(201)
		w.Write([]byte(`{"client_id":"product-client"}`))
	})
	mux.HandleFunc("/oauth2/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		f.exchanges.Add(1)
		f.verifier = r.Form.Get("code_verifier")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"access_token":"scoped-access-secret","refresh_token":"scoped-refresh-secret","token_type":"Bearer","expires_in":3600}`))
	})
	mux.HandleFunc("/oauth2/revoke", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	mux.Handle("/mcp", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer scoped-access-secret" {
			w.WriteHeader(401)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	f.issuer = httptest.NewServer(mux)
	t.Cleanup(f.issuer.Close)
	f.service, err = New(st, []byte("fixture-encryption-secret"), f.issuer.URL, f.issuer.URL+"/mcp", "https://product.example")
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *fixture) connect(t *testing.T) {
	t.Helper()
	destination, err := f.service.Begin(t.Context(), f.user)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(destination)
	q := u.Query()
	if q.Get("scope") != "garmin:access offline_access" || q.Get("resource") != f.issuer.URL+"/mcp" || q.Get("code_challenge_method") != "S256" {
		t.Fatalf("incorrect authorization parameters: %s", destination)
	}
	if err := f.service.Finish(t.Context(), q.Get("state"), "one-time-code"); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(f.verifier))
	if base64.RawURLEncoding.EncodeToString(sum[:]) != q.Get("code_challenge") {
		t.Fatal("PKCE verifier was not bound to the pending request")
	}
	if err := f.service.Finish(t.Context(), q.Get("state"), "one-time-code"); err == nil {
		t.Fatal("replayed OAuth state accepted")
	}
}

func TestConnectionEncryptedOwnerScopedAndRevocable(t *testing.T) {
	f := newFixture(t)
	f.connect(t)
	if !f.service.Linked("alice") || f.service.Linked("bob") {
		t.Fatal("connection leaked across owners")
	}
	if _, err := f.service.Call(t.Context(), "bob", "create_workout", map[string]any{}); !errors.Is(err, ErrDisconnected) {
		t.Fatalf("unconnected owner authorized: %v", err)
	}
	var raw []byte
	if err := f.service.st.DB.QueryRow("SELECT value FROM integration_state WHERE key='grant/alice'").Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("scoped-")) || bytes.Contains(raw, []byte("garmin-alice")) {
		t.Fatal("plaintext integration credentials persisted")
	}
	if _, err := f.service.st.DB.Exec("INSERT INTO integration_state(key,value) VALUES('grant/bob',?)", raw); err != nil {
		t.Fatal(err)
	}
	if f.service.Linked("bob") {
		t.Fatal("ciphertext could be moved between owner keys")
	}
	if err := f.service.Disconnect(t.Context(), "alice"); err != nil {
		t.Fatal(err)
	}
	if f.service.Linked("alice") {
		t.Fatal("disconnected grant retained")
	}
}

func TestExpiredConnectionIsConsumedWithoutExchange(t *testing.T) {
	f := newFixture(t)
	if err := f.service.save("oauth/expired", pending{UID: "alice", Expires: time.Now().Add(-time.Second)}, "alice"); err != nil {
		t.Fatal(err)
	}
	if err := f.service.Finish(t.Context(), "expired", "code"); err == nil {
		t.Fatal("expired state accepted")
	}
	if f.exchanges.Load() != 0 {
		t.Fatal("expired state reached token endpoint")
	}
}

func TestPublicationReplaysNeverRepeatProviderWrites(t *testing.T) {
	for _, ambiguous := range []bool{false, true} {
		t.Run(map[bool]string{false: "scheduled", true: "lost schedule response"}[ambiguous], func(t *testing.T) {
			f := newFixture(t)
			f.connect(t)
			f.failSchedule.Store(ambiguous)
			request := PublishRequest{ID: "operation-1", Date: "2026-10-25", Workout: jsontext.Value(`{"workoutName":"A","sport":"STRENGTH_TRAINING","segments":[]}`)}
			result, err := f.service.Publish(t.Context(), "alice", request)
			if err != nil {
				t.Fatal(err)
			}
			want := "scheduled"
			if ambiguous {
				want = "needs_review"
			}
			if result.Phase != want || result.WorkoutID != 123 {
				t.Fatalf("incorrect journal: %+v", result)
			}
			// Restart the service with the same encrypted database, then replay the exact approval.
			restarted, err := New(f.service.st, []byte("fixture-encryption-secret"), f.issuer.URL, f.issuer.URL+"/mcp", "https://product.example")
			if err != nil {
				t.Fatal(err)
			}
			replay, err := restarted.Publish(t.Context(), "alice", request)
			if err != nil || replay != result {
				t.Fatalf("replay changed outcome: %+v %v", replay, err)
			}
			if f.creates.Load() != 1 || f.schedules.Load() != 1 {
				t.Fatalf("replay repeated writes: create=%d schedule=%d", f.creates.Load(), f.schedules.Load())
			}
			request.Workout = jsontext.Value(`{"workoutName":"Different"}`)
			if _, err := restarted.Publish(t.Context(), "alice", request); err == nil {
				t.Fatal("operation id reused for different details")
			}
		})
	}
}

func TestRefreshIsSavedBeforeGrantIsUsed(t *testing.T) {
	f := newFixture(t)
	if err := f.service.save("grant/alice", grant{ClientID: "product-client", Token: &oauth2.Token{AccessToken: "expired", RefreshToken: "refresh", Expiry: time.Now().Add(-time.Hour)}}, "alice"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.Call(t.Context(), "alice", "create_workout", map[string]any{}); err != nil {
		t.Fatal(err)
	}
	var connection grant
	if err := f.service.read("grant/alice", &connection, false); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(connection)
	if !strings.Contains(string(raw), "scoped-refresh-secret") {
		t.Fatal("rotated grant was not persisted")
	}
}

func TestDeletingProductAccountRemovesConnectorGrantsAndPendingConsent(t *testing.T) {
	f := newFixture(t)
	f.connect(t)
	if _, err := f.service.Begin(t.Context(), f.user); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.st.DB.Exec("DELETE FROM users WHERE id=?", "alice"); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := f.service.st.DB.QueryRow("SELECT count(*) FROM integration_state WHERE owner=?", "alice").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 || f.service.Linked("alice") {
		t.Fatal("deleted account retained integration data")
	}
}
