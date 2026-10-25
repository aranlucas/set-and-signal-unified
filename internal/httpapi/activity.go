package httpapi

import (
	"net/http"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/presence"
)

// POST /api/activity — live-workout heartbeat (server.js lines 754–769).
// The client pings while a workout is on screen; active:false drops the
// entry. Cookie-only, like upstream's readSession guard.
func (s *Server) postActivity(w http.ResponseWriter, r *http.Request) {
	u := s.requireSession(w, r)
	if u == nil {
		return
	}
	var body struct {
		Active    bool   `json:"active"`
		Name      string `json:"name" validate:"max=60"`
		ExIdx     int    `json:"exIdx" validate:"gte=0"`
		ExTotal   int    `json:"exTotal" validate:"gte=0"`
		SetsDone  int    `json:"setsDone" validate:"gte=0"`
		SetsTotal int    `json:"setsTotal" validate:"gte=0"`
		StartedAt int64  `json:"startedAt" validate:"gte=0"`
	}
	if !readValidatedJSON(w, r, &body) {
		return
	}
	if body.Active {
		started := body.StartedAt
		if started == 0 {
			started = time.Now().UnixMilli()
		}
		s.Presence.Set(u.ID, presence.Info{
			Name:      body.Name,
			ExIdx:     body.ExIdx,
			ExTotal:   body.ExTotal,
			SetsDone:  body.SetsDone,
			SetsTotal: body.SetsTotal,
			StartedAt: time.UnixMilli(started),
		})
	} else {
		s.Presence.Delete(u.ID)
	}
	writeJSON(w, http.StatusOK, okResponse{OK: true})
}
