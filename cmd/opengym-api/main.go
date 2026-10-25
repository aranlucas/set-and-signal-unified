// Command opengym-api wires every backend subsystem together and serves it:
// config → SQLite store → sessions → WebAuthn → push → presence → AI →
// chi router, with the SPA (embedded or WEB_DIST) mounted in front.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	// Embedded IANA zones so time.LoadLocation (reminder loop) works on
	// tzdata-less container images; ~450KB, fallback-only when the system
	// zoneinfo is present.
	_ "time/tzdata"

	"github.com/aranlucas/set-and-signal-unified/internal/ai"
	"github.com/aranlucas/set-and-signal-unified/internal/auth"
	"github.com/aranlucas/set-and-signal-unified/internal/config"
	"github.com/aranlucas/set-and-signal-unified/internal/convex"
	"github.com/aranlucas/set-and-signal-unified/internal/garmin"
	"github.com/aranlucas/set-and-signal-unified/internal/httpapi"
	"github.com/aranlucas/set-and-signal-unified/internal/oauth"
	"github.com/aranlucas/set-and-signal-unified/internal/presence"
	"github.com/aranlucas/set-and-signal-unified/internal/push"
	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

// challengesSweep is how often expired WebAuthn challenge rows are pruned;
// upstream's in-memory map vanished on restart, the table needs a janitor.
const challengesSweep = 10 * time.Minute

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("api: ")
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

// app carries everything the background loops and HTTP server need.
type app struct {
	handler  http.Handler
	st       *store.Store
	presence *presence.Presence
	push     *push.Service
}

// maxHeaderValueCount is intentionally tighter than net/http's default of
// 500; Set & Signal requests use only a small, fixed set of header values.
const maxHeaderValueCount = 100

func run() error {
	cfg := config.Load()
	if cfg.ConvexURL == "" {
		return errors.New("CONVEX_URL is required; configure the training deployment before starting the hosted API")
	}
	a, err := wire(cfg)
	if err != nil {
		return err
	}
	defer func() {
		if err := a.st.DB.Close(); err != nil {
			log.Printf("close database: %v", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	a.runBackground(ctx)

	srv := &http.Server{
		Addr:                ":" + cfg.Port,
		Handler:             a.handler,
		ReadHeaderTimeout:   10 * time.Second,
		MaxHeaderValueCount: maxHeaderValueCount,
	}
	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	log.Printf("listening on :%s", cfg.Port)

	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	return nil
}

// wire opens every dependency and builds the full HTTP handler.
func wire(cfg config.Config) (*app, error) {
	st, err := store.OpenAtPath(cfg.DBPath)
	if err != nil {
		return nil, err
	}
	var convexClient *convex.Client
	if cfg.ConvexURL != "" {
		convexClient, err = convex.New(cfg.ConvexURL, cfg.PublicURL, cfg.DataDir)
		if err != nil {
			return nil, err
		}
		st.Training = convexClient
	}
	sess, err := auth.NewSessions(cfg.DataDir, cfg.SessionDays)
	if err != nil {
		return nil, err
	}
	wa, err := auth.New(st, cfg)
	if err != nil {
		return nil, err
	}
	pushSvc, err := push.New(cfg.DataDir, st, vapidSubject(cfg))
	if err != nil {
		return nil, err
	}

	var garminService *garmin.Service
	if cfg.GarminIssuer != "" {
		garminService, err = garmin.New(st, sess.Secret, cfg.GarminIssuer, cfg.GarminResource, cfg.PublicURL)
		if err != nil {
			return nil, err
		}
	}
	server := &httpapi.Server{
		Cfg:      cfg,
		Convex:   convexClient,
		ST:       st,
		Sess:     sess,
		WA:       wa,
		Push:     pushSvc,
		Presence: presence.New(),
		AI:       ai.New(cfg.OpenRouterKey, cfg.OpenRouterModel, cfg.Origin),
		OAuth:    oauth.New(cfg, st, sess),
		Garmin:   garminService,
	}
	return &app{
		handler:  httpapi.Static(server),
		st:       st,
		presence: server.Presence,
		push:     pushSvc,
	}, nil
}

// runBackground starts the janitors that live for the process lifetime; they
// all exit when ctx is cancelled during shutdown.
func (a *app) runBackground(ctx context.Context) {
	go a.presence.RunJanitor(ctx)
	go a.push.RunReminderLoop(ctx, userNow)
	go func() {
		ticks := time.Tick(challengesSweep)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticks:
				now := time.Now().Unix()
				if err := a.st.CleanExpiredChallenges(now); err != nil {
					log.Printf("challenge sweep: %v", err)
				}
				if err := a.st.CleanExpiredOAuthCodes(now); err != nil {
					log.Printf("OAuth code sweep: %v", err)
				}
				if err := a.st.CleanExpiredOAuthRefresh(now); err != nil {
					log.Printf("OAuth refresh sweep: %v", err)
				}
			}
		}
	}()
}

// userNow resolves "now" in an arbitrary IANA zone — each user's reminder
// fires by their own clock (port of userNow, server.js lines 117–126).
func userNow(tz string) (date, hhmm string, ok bool) {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return "", "", false // unknown zone — skip rather than guess
	}
	t := time.Now().In(loc)
	return t.Format("2006-01-02"), t.Format("15:04"), true
}

// vapidSubject mirrors upstream (server.js line 65): VAPID_SUBJECT wins,
// else the origin for https instances, else a mailto fallback.
func vapidSubject(cfg config.Config) string {
	if s := os.Getenv("VAPID_SUBJECT"); s != "" {
		return s
	}
	if strings.HasPrefix(cfg.Origin, "https:") {
		return cfg.Origin
	}
	return "mailto:admin@localhost"
}
