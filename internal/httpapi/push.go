package httpapi

import (
	"math"
	"net/http"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

// Push notification endpoints (server.js lines 707–752). All mutating push
// routes are cookie-only, like upstream's readSession guard; only the VAPID
// public key is public.

// GET /api/push/public-key — no auth upstream; the frontend needs the key to
// subscribe before anyone signs in.
func (s *Server) pushPublicKey(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, struct {
		Key string `json:"key"`
	}{Key: s.Push.PublicKey()})
}

// POST /api/push/subscribe — records one subscription per endpoint, replacing
// any earlier row with the same endpoint.
func (s *Server) postPushSubscribe(w http.ResponseWriter, r *http.Request) {
	u := s.requireSession(w, r)
	if u == nil {
		return
	}
	var body struct {
		Subscription struct {
			Endpoint       string `json:"endpoint" validate:"required"`
			ExpirationTime *int64 `json:"expirationTime"`
			Keys           struct {
				P256DH string `json:"p256dh" validate:"required"`
				Auth   string `json:"auth" validate:"required"`
			} `json:"keys"`
		} `json:"subscription"`
	}
	if !readValidatedJSON(w, r, &body) {
		return
	}
	sub := body.Subscription
	if err := s.ST.UpsertPushSub(store.PushSub{
		Endpoint: sub.Endpoint,
		UserID:   u.ID,
		P256DH:   sub.Keys.P256DH,
		Auth:     sub.Keys.Auth,
		Created:  time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		serverError(w)
		return
	}
	writeJSON(w, http.StatusOK, okResponse{OK: true})
}

// POST /api/push/unsubscribe — drops one of *the caller's* subscriptions by
// endpoint; unknown endpoints still answer ok like upstream's filter no-op.
func (s *Server) postPushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	u := s.requireSession(w, r)
	if u == nil {
		return
	}
	var body struct {
		Endpoint string `json:"endpoint" validate:"required"`
	}
	if !readValidatedJSON(w, r, &body) {
		return
	}
	endpoint := body.Endpoint
	subs, err := s.ST.SubsByUser(u.ID)
	if err != nil {
		serverError(w)
		return
	}
	for _, sub := range subs {
		if sub.Endpoint == endpoint {
			if err := s.ST.DeletePushSub(endpoint); err != nil {
				serverError(w)
				return
			}
			break
		}
	}
	writeJSON(w, http.StatusOK, okResponse{OK: true})
}

// POST /api/push/test — one sample notification so the user can check their
// device actually receives alerts.
func (s *Server) postPushTest(w http.ResponseWriter, r *http.Request) {
	u := s.requireSession(w, r)
	if u == nil {
		return
	}
	s.Push.SendTo(u.ID, "Set & Signal", "Test notification ✅ — this is what alerts look like.", "test")
	writeJSON(w, http.StatusOK, okResponse{OK: true})
}

// POST /api/push/rest-timer — arms a rest-over alert, from 1 to 3600 seconds.
func (s *Server) postRestTimer(w http.ResponseWriter, r *http.Request) {
	u := s.requireSession(w, r)
	if u == nil {
		return
	}
	var body struct {
		Seconds float64 `json:"seconds" validate:"gte=1,lte=3600"`
	}
	if !readValidatedJSON(w, r, &body) {
		return
	}
	sec := math.Round(body.Seconds)
	s.Push.ScheduleRestTimer(u.ID, int(sec))
	writeJSON(w, http.StatusOK, okResponse{OK: true})
}

// POST /api/push/rest-timer/cancel — disarms the pending rest timer.
func (s *Server) postRestTimerCancel(w http.ResponseWriter, r *http.Request) {
	u := s.requireSession(w, r)
	if u == nil {
		return
	}
	s.Push.CancelRestTimer(u.ID)
	writeJSON(w, http.StatusOK, okResponse{OK: true})
}
