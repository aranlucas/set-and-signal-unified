package httpapi

import (
	"bytes"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/aranlucas/set-and-signal-unified/web"
)

// placeholderIndex is served when neither the embedded tree nor WEB_DIST has
// an index.html — "/" stays 404-free on a bare install.
const placeholderIndex = `<!doctype html>
<html><head><meta charset="utf-8"><title>Set &amp; Signal</title></head>
<body><h1>Set &amp; Signal API</h1>
<p>The frontend build was not found. Set <code>WEB_DIST</code> to a directory
containing <code>index.html</code>, or place a build in <code>web/dist</code>.</p>
</body></html>`

// Static mounts the API router under /api/* (plus /mcp) and serves the SPA
// everywhere else: exact files win, everything unknown falls back to
// index.html so client-side routes survive refresh. Hashed assets under
// /assets/ are long-cached; index.html is revalidated every load.
func Static(s *Server) http.Handler {
	api := Router(s)
	webFS := web.Dist()
	if dir := os.Getenv("WEB_DIST"); dir != "" {
		webFS = os.DirFS(dir)
	}
	return &staticHandler{api: api, web: webFS}
}

type staticHandler struct {
	api http.Handler
	web fs.FS
}

func (h *staticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	if p == "/api" || strings.HasPrefix(p, "/api/") ||
		p == "/mcp" || strings.HasPrefix(p, "/mcp/") ||
		p == "/oauth" || strings.HasPrefix(p, "/oauth/") ||
		strings.HasPrefix(p, "/.well-known/") {
		h.api.ServeHTTP(w, r)
		return
	}

	name := strings.TrimPrefix(path.Clean("/"+p), "/")
	if name == "" {
		name = "index.html"
	}
	f, err := h.web.Open(name)
	if err != nil {
		h.serveIndex(w, r)
		return
	}
	info, statErr := f.Stat()
	_ = f.Close()
	if statErr != nil || info.IsDir() {
		h.serveIndex(w, r)
		return
	}

	switch name {
	case "index.html":
		w.Header().Set("Cache-Control", "no-cache")
	default:
		if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
	}
	http.FileServerFS(h.web).ServeHTTP(w, r)
}

// serveIndex falls back to index.html for client-side routes; when no build
// exists at all it serves a small placeholder so "/" is never broken.
func (h *staticHandler) serveIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	if f, err := h.web.Open("index.html"); err == nil {
		data, readErr := io.ReadAll(f)
		_ = f.Close()
		if readErr == nil && len(data) > 0 {
			http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(data))
			return
		}
	}
	http.ServeContent(w, r, "index.html", time.Time{}, strings.NewReader(placeholderIndex))
}
