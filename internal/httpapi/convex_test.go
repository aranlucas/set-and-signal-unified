package httpapi

import (
	"github.com/aranlucas/set-and-signal-unified/internal/convex"
	"github.com/golang-jwt/jwt/v5"
	"testing"
)

func TestConvexTokenUsesCookieIdentity(t *testing.T) {
	e := newTestEnv(t)
	c, err := convex.New("https://test.convex.cloud", "https://api.example.test", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.srv.Convex = c
	response, body := e.do("GET", "/api/convex/token", "", "admin")
	if response.StatusCode != 200 || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("token response: %d %v", response.StatusCode, body)
	}
	raw, ok := body["token"].(string)
	if !ok {
		t.Fatal("missing token")
	}
	claims := jwt.MapClaims{}
	if _, _, err := jwt.NewParser().ParseUnverified(raw, claims); err != nil {
		t.Fatal(err)
	}
	if claims["sub"] != "u1" || claims["service"] != false || claims["aud"] != "set-and-signal" {
		t.Fatalf("unexpected claims: %v", claims)
	}
	if response, _ := e.do("GET", "/api/convex/token", "", "raw:"); response.StatusCode != 401 {
		t.Fatalf("anonymous token = %d", response.StatusCode)
	}
	if response, _ := e.do("PUT", "/api/data", `{"state":{}}`, "admin"); response.StatusCode != 404 {
		t.Fatalf("removed upload route: %d", response.StatusCode)
	}
}
