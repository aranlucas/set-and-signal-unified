package httpapi

import (
	"errors"
	"net/http"
	"regexp"

	"github.com/aranlucas/set-and-signal-unified/internal/garmin"
	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

var garminActivityID = regexp.MustCompile(`^[1-9][0-9]{0,19}$`)

func (s *Server) garminStatus(w http.ResponseWriter, r *http.Request) {
	user := s.requireAnyAuth(w, r)
	if user == nil {
		return
	}
	writeJSON(w, 200, struct {
		Configured bool `json:"configured"`
		Connected  bool `json:"connected"`
	}{s.Garmin != nil, s.Garmin != nil && s.Garmin.Linked(user.ID)})
}

func (s *Server) garminConnect(w http.ResponseWriter, r *http.Request) {
	user := s.requireAnyAuth(w, r)
	if user == nil {
		return
	}
	if s.Garmin == nil {
		writeErr(w, 503, "Garmin is not configured")
		return
	}
	destination, err := s.Garmin.Begin(r.Context(), *user)
	if err != nil {
		writeErr(w, 502, "Could not start Garmin connection")
		return
	}
	writeJSON(w, 200, struct {
		URL string `json:"url"`
	}{destination})
}

func (s *Server) garminCallback(w http.ResponseWriter, r *http.Request) {
	if s.Garmin == nil {
		writeErr(w, 503, "Garmin is not configured")
		return
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	if err := s.Garmin.Finish(r.Context(), r.URL.Query().Get("state"), r.URL.Query().Get("code")); err != nil {
		writeErr(w, 400, "Garmin connection was cancelled or expired. Return to Set & Signal and reconnect.")
		return
	}
	http.Redirect(w, r, "/#/settings?garmin=connected", http.StatusSeeOther)
}

func (s *Server) garminDisconnect(w http.ResponseWriter, r *http.Request) {
	user := s.requireAnyAuth(w, r)
	if user == nil {
		return
	}
	if s.Garmin != nil {
		if err := s.Garmin.Disconnect(r.Context(), user.ID); err != nil {
			writeErr(w, 502, "Could not revoke the Garmin connection. Try again.")
			return
		}
	}
	writeJSON(w, 200, okResponse{OK: true})
}

func (s *Server) garminDay(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("date")
	if !training.ValidISODate(date) {
		writeErr(w, 400, "date must be YYYY-MM-DD")
		return
	}
	s.garminRead(w, r, "get_garmin_day", struct {
		Date  string `json:"date"`
		Limit int    `json:"limitPerType"`
	}{date, 100})
}

func (s *Server) garminActivity(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("activityId")
	if !garminActivityID.MatchString(id) {
		writeErr(w, 400, "invalid activity id")
		return
	}
	s.garminRead(w, r, "get_garmin_activity", struct {
		ID string `json:"activityId"`
	}{id})
}

func (s *Server) garminRead(w http.ResponseWriter, r *http.Request, name string, args any) {
	user := s.requireAnyAuth(w, r)
	if user == nil {
		return
	}
	if s.Garmin == nil {
		writeErr(w, 503, "Garmin is not configured")
		return
	}
	value, err := s.Garmin.Call(r.Context(), user.ID, name, args)
	if err != nil {
		code := 502
		if errors.Is(err, garmin.ErrDisconnected) {
			code = 409
		}
		writeErr(w, code, err.Error())
		return
	}
	writeJSON(w, 200, value)
}

func (s *Server) garminPublish(w http.ResponseWriter, r *http.Request) {
	user := s.requireAnyAuth(w, r)
	if user == nil {
		return
	}
	if s.Garmin == nil {
		writeErr(w, 503, "Garmin is not configured")
		return
	}
	var body garmin.PublishRequest
	if !readJSON(w, r, &body) {
		return
	}
	// A new operation is submitted only by the user's explicit preview approval.
	result, err := s.Garmin.Publish(r.Context(), user.ID, body)
	if err != nil {
		code := 400
		if errors.Is(err, garmin.ErrDisconnected) {
			code = 409
		}
		writeErr(w, code, err.Error())
		return
	}
	writeJSON(w, 200, result)
}

// nativeIdentity is the first-party identity probe for authenticated Android.
// The browser /api/me endpoint retains its cookie-only compatibility contract.
func (s *Server) nativeIdentity(w http.ResponseWriter, r *http.Request) {
	user := s.requireAnyAuth(w, r)
	if user == nil {
		return
	}
	writeJSON(w, 200, userResponse{User: s.userPayload(*user)})
}

// importWorkout accepts a reviewed source record, preserves its stable identity,
// and delegates the same typed operation used by MCP. It does not infer a
// completed workout from a planned Garmin schedule.
func (s *Server) importWorkout(w http.ResponseWriter, r *http.Request) {
	user := s.requireAnyAuth(w, r)
	if user == nil {
		return
	}
	var body struct {
		Workout MCPWorkout `json:"workout"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	result, err := NewTrainingDataRepository(s.ST).PutWorkout(user.ID, body.Workout)
	if err != nil {
		writeErr(w, 400, "Invalid recorded workout: "+err.Error())
		return
	}
	writeJSON(w, 200, MCPWorkoutOutput{OK: true, Workout: result})
}

func (s *Server) finalizeWorkout(w http.ResponseWriter, r *http.Request) {
	user := s.requireAnyAuth(w, r)
	if user == nil {
		return
	}
	var body struct {
		ID string `json:"id"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.ID == "" || len(body.ID) > 200 {
		writeErr(w, 400, "invalid workout id")
		return
	}
	if err := NewTrainingDataRepository(s.ST).FinalizeWorkout(user.ID, body.ID); err != nil {
		serverError(w)
		return
	}
	writeJSON(w, 200, okResponse{OK: true})
}
