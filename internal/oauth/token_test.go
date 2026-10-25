package oauth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aranlucas/set-and-signal-unified/internal/auth"
	"github.com/aranlucas/set-and-signal-unified/internal/config"
	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

func TestWriteTokenResponseFailsWhenRefreshTokenCannotPersist(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.DB.Close() })
	if err := st.CreateUser(store.User{ID: "u1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.DB.Exec(`
		CREATE TRIGGER reject_refresh_insert
		BEFORE INSERT ON oauth_refresh
		BEGIN
			SELECT RAISE(FAIL, 'injected refresh persistence failure');
		END
	`); err != nil {
		t.Fatal(err)
	}

	s := New(
		config.Config{PublicURL: "https://set-and-signal.example"},
		st,
		&auth.Sessions{Secret: []byte("test-secret"), Days: 1},
	)
	w := httptest.NewRecorder()
	s.writeTokenResponse(w, "u1", "client-1", ScopeAll, s.ResourceURI())

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "refresh_token") {
		t.Fatalf("response exposed an unpersisted refresh token: %s", w.Body.String())
	}
}
