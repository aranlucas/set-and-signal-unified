package main

import (
	"context"
	"encoding/json/v2"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aranlucas/set-and-signal-unified/internal/config"
)

// startApp wires a full app against temp dirs and serves it in memory.
func startApp(t *testing.T, webDist string) (string, *http.Client) {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("WEB_DIST", webDist)
	cfg := config.Config{
		Port:            "0",
		DataDir:         tmp,
		DBPath:          filepath.Join(tmp, "opengym.db"),
		RPID:            "localhost",
		Origin:          "http://localhost:8080",
		RPName:          "Set & Signal",
		SessionDays:     7,
		OpenRouterModel: "test/model",
	}
	a, err := wire(cfg)
	if err != nil {
		t.Fatalf("wire: %v", err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	a.runBackground(ctx)
	t.Cleanup(func() {
		cancel()
		_ = a.st.DB.Close()
	})
	ts := httptest.NewTestServer(t, a.handler)
	client := ts.Client()
	return ts.URL, client
}

func get(t *testing.T, client *http.Client, url string) (*http.Response, string) {
	t.Helper()
	resp, err := client.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body %s: %v", url, err)
	}
	return resp, string(body)
}

func writeDist(t *testing.T) string {
	t.Helper()
	dist := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dist, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"index.html":           "<!doctype html><title>Set &amp; Signal SPA</title>",
		"assets/app-abc123.js": "console.log('spa');",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dist, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dist
}

// TestEndToEnd exercises the complete routing surface in memory: API under
// /api/*, MCP under /mcp, and SPA fallback everywhere else.
func TestEndToEnd(t *testing.T) {
	base, client := startApp(t, writeDist(t))

	resp, body := get(t, client, base+"/api/health")
	var health struct {
		OK    bool `json:"ok"`
		Users int  `json:"users"`
	}
	if err := json.Unmarshal([]byte(body), &health); resp.StatusCode != http.StatusOK || err != nil || !health.OK || health.Users != 0 {
		t.Errorf("health: status=%d body=%q", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("health content-type: %q", ct)
	}

	resp, body = get(t, client, base+"/")
	if resp.StatusCode != http.StatusOK || !strings.Contains(body, "Set &amp; Signal SPA") {
		t.Errorf("/ : status=%d body=%q", resp.StatusCode, body)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("index cache-control: %q", cc)
	}

	// Client-side route refreshes fall back to the SPA shell.
	resp, body = get(t, client, base+"/workouts/today")
	if resp.StatusCode != http.StatusOK || !strings.Contains(body, "Set &amp; Signal SPA") {
		t.Errorf("SPA fallback: status=%d body=%q", resp.StatusCode, body)
	}

	// Hashed assets are long-cached and served verbatim.
	resp, body = get(t, client, base+"/assets/app-abc123.js")
	if resp.StatusCode != http.StatusOK || body != "console.log('spa');" {
		t.Errorf("asset: status=%d body=%q", resp.StatusCode, body)
	}
	if cc := resp.Header.Get("Cache-Control"); !strings.Contains(cc, "immutable") ||
		!strings.Contains(cc, "max-age=31536000") {
		t.Errorf("asset cache-control: %q", cc)
	}

	// Unknown /api paths are API 404s (JSON), never the SPA shell.
	resp, _ = get(t, client, base+"/api/nope")
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown api path: status=%d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("unknown api path content-type: %q", ct)
	}

	// /mcp is routed to the API (bearer-only auth), not static files.
	resp, _ = get(t, client, base+"/mcp")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("mcp unauthenticated: status=%d", resp.StatusCode)
	}
}

// TestEmbeddedFallback covers the bare install: an explicitly empty WEB_DIST
// must still answer with a page instead of breaking. Using a temp directory
// keeps the test independent of ignored files under web/dist.
func TestEmbeddedFallback(t *testing.T) {
	t.Setenv("WEB_DIST", t.TempDir())
	cfg := config.Config{
		Port:        "0",
		DataDir:     t.TempDir(),
		DBPath:      filepath.Join(t.TempDir(), "opengym.db"),
		RPID:        "localhost",
		Origin:      "http://localhost:8080",
		RPName:      "Set & Signal",
		SessionDays: 7,
	}
	a, err := wire(cfg)
	if err != nil {
		t.Fatalf("wire: %v", err)
	}
	t.Cleanup(func() { _ = a.st.DB.Close() })
	ts := httptest.NewTestServer(t, a.handler)
	client := ts.Client()

	resp, body := get(t, client, ts.URL+"/")
	if resp.StatusCode != http.StatusOK || !strings.Contains(body, "Set &amp; Signal") {
		t.Errorf("embedded /: status=%d body=%q", resp.StatusCode, body)
	}
}
