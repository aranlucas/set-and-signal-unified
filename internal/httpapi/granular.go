package httpapi

import (
	"cmp"
	"encoding/json/v2"
	"maps"
	"net/http"
	"slices"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

// POST /api/routine — upsert one sanitized routine by id. Cookie or bearer.
func (s *Server) postRoutine(w http.ResponseWriter, r *http.Request) {
	u := s.requireAnyAuth(w, r)
	if u == nil {
		return
	}
	var body struct {
		Routine training.MCPRoutineInput `json:"routine"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	payload, code, msg := s.applyRoutine(u.ID, body.Routine)
	writeResult(w, payload, code, msg)
}

// POST /api/routines — batch-create / update a training program: one or more
// routines plus an optional weekday schedule. Cookie or bearer (OAuth).
// Body: { routines: [...], week?: {"0".."6": [{routineId, start?, label?}]}, replace?: bool }.
// When replace is true, existing routines are cleared first (week/dayPlan refs
// to deleted ids are dropped). Missing routine ids are derived from the name.
func (s *Server) postRoutines(w http.ResponseWriter, r *http.Request) {
	u := s.requireAnyAuth(w, r)
	if u == nil {
		return
	}
	var body struct {
		Routines []training.MCPRoutineInput `json:"routines"`
		Week     training.WeekSchedule      `json:"week"`
		Replace  bool                       `json:"replace"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	payload, code, msg := s.applyProgram(u.ID, body.Routines, body.Week, body.Replace)
	writeResult(w, payload, code, msg)
}

// writeResult answers active REST mutations with payload on success or the
// {error: msg} envelope at the given status.
func writeResult[T any](w http.ResponseWriter, payload T, code int, msg string) {
	if code != 0 {
		writeErr(w, code, msg)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

// applyRoutine is the mutation core of POST /api/routine.
func (s *Server) applyRoutine(uid string, routine training.MCPRoutineInput) (routineResponse, int, string) {
	rc, err := normalizeRoutine(routine)
	if err != nil {
		return routineResponse{}, http.StatusBadRequest, err.Error()
	}
	err = s.mutateDocument(uid, func(document stateDocument) error {
		routines := document.routines()
		if err := routines.upsert(rc); err != nil {
			return err
		}
		return document.set("routines", routines)
	})
	if err != nil {
		return routineResponse{}, http.StatusInternalServerError, "server error"
	}
	return routineResponse{OK: true, Routine: rc}, 0, ""
}

// applyProgram batch-upserts routines and optionally sets the week schedule
// in one state write — the shape AI agents use to install a full program.
func (s *Server) applyProgram(uid string, routines []training.MCPRoutineInput, inputWeek training.WeekSchedule, replace bool) (programResponse, int, string) {
	prepared, err := prepareTypedProgram(routines, inputWeek)
	if err != nil {
		return programResponse{}, http.StatusBadRequest, err.Error()
	}
	week, err := s.mutateProgram(uid, prepared, replace)
	if err != nil {
		return programResponse{}, http.StatusInternalServerError, "server error"
	}
	out := programResponse{OK: true, Routines: prepared.routines}
	if prepared.hasWeek {
		out.Week = new(week)
	}
	return out, 0, ""
}

// mutateProgram applies a prepared HTTP program atomically.
func (s *Server) mutateProgram(uid string, prepared typedPreparedProgram, replace bool) (training.WeekSchedule, error) {
	var week training.WeekSchedule
	err := s.mutateDocument(uid, func(document stateDocument) error {
		var err error
		week, err = applyPreparedProgram(document, prepared, replace)
		return err
	})
	return week, err
}

// applyPreparedProgram is intentionally side-effect free beyond document and uses
// the same replacement, reference-pruning, upsert, and ghost-week rules as
// the historical /api/routines implementation.
func applyPreparedProgram(document stateDocument, prepared typedPreparedProgram, replace bool) (training.WeekSchedule, error) {
	routines := document.routines()
	if replace {
		routines = storedRoutines{}
		if err := document.set("week", training.WeekSchedule{}); err != nil {
			return nil, err
		}
		plan, err := training.DecodeDayPlanMap(document["dayPlan"])
		if err != nil {
			plan = training.DayPlanMap{}
		}
		maps.DeleteFunc(plan, func(_ string, entry training.MCPDayPlan) bool { return !entry.Rest })
		if err := document.set("dayPlan", plan); err != nil {
			return nil, err
		}
	}
	for _, routine := range prepared.routines {
		if err := routines.upsert(routine); err != nil {
			return nil, err
		}
	}
	if err := document.set("routines", routines); err != nil {
		return nil, err
	}
	week := training.CloneWeekSchedule(prepared.week)
	if prepared.hasWeek {
		pruneGhostSessions(week, routines.ids())
		if err := document.set("week", week); err != nil {
			return nil, err
		}
	}
	return week, nil
}

func pruneGhostSessions(week training.WeekSchedule, ids map[string]bool) {
	for day, sessions := range week {
		kept := slices.DeleteFunc(sessions, func(session training.MCPDaySession) bool { return !ids[session.RoutineID] })
		if len(kept) == 0 {
			delete(week, day)
		} else {
			week[day] = kept
		}
	}
}

func pruneRoutineFromSchedule(document stateDocument, id string) error {
	week, err := training.DecodeWeekMap(document["week"])
	if err == nil {
		for day, sessions := range week {
			kept := slices.DeleteFunc(sessions, func(session training.MCPDaySession) bool { return session.RoutineID == id })
			if len(kept) == 0 {
				delete(week, day)
			} else {
				week[day] = kept
			}
		}
		if err := document.set("week", week); err != nil {
			return err
		}
	}
	plan, err := training.DecodeDayPlanMap(document["dayPlan"])
	if err == nil {
		for day, entry := range plan {
			if entry.Rest || len(entry.Sessions) == 0 {
				continue
			}
			entry.Sessions = slices.DeleteFunc(entry.Sessions, func(session training.MCPDaySession) bool { return session.RoutineID == id })
			if len(entry.Sessions) == 0 {
				delete(plan, day)
			} else {
				plan[day] = entry
			}
		}
		return document.set("dayPlan", plan)
	}
	return nil
}

// POST /api/routine/delete — removes the routine plus every week/dayPlan
// slot pointing at it.
func (s *Server) deleteRoutine(w http.ResponseWriter, r *http.Request) {
	u := s.requireAnyAuth(w, r)
	if u == nil {
		return
	}
	var body struct {
		ID string `json:"id" validate:"required,max=40"`
	}
	if !readValidatedJSON(w, r, &body) {
		return
	}
	payload, code, msg := s.applyRoutineDelete(u.ID, body.ID)
	writeResult(w, payload, code, msg)
}

// applyRoutineDelete is the mutation core of POST /api/routine/delete.
func (s *Server) applyRoutineDelete(uid string, id string) (okResponse, int, string) {
	err := s.mutateDocument(uid, func(document stateDocument) error {
		routines := slices.DeleteFunc(document.routines(), func(routine storedRoutine) bool { return routine.ID != nil && *routine.ID == id })
		if err := document.set("routines", routines); err != nil {
			return err
		}
		return pruneRoutineFromSchedule(document, id)
	})
	if err != nil {
		return okResponse{}, http.StatusInternalServerError, "server error"
	}
	return okResponse{OK: true}, 0, ""
}

// POST /api/week — replace the whole weekday→sessions schedule. Keys must be
// exactly "0".."6"; values are ordered session arrays. Ghost routine ids are dropped.
func (s *Server) postWeek(w http.ResponseWriter, r *http.Request) {
	u := s.requireAnyAuth(w, r)
	if u == nil {
		return
	}
	var body struct {
		Week training.WeekSchedule `json:"week" validate:"required"`
	}
	if !readValidatedJSON(w, r, &body) {
		return
	}
	payload, code, msg := s.applyWeek(u.ID, body.Week)
	writeResult(w, payload, code, msg)
}

// applyWeek is the mutation core of POST /api/week.
func (s *Server) applyWeek(uid string, inputWeek training.WeekSchedule) (okResponse, int, string) {
	week, err := normalizeWeek(inputWeek)
	if err != nil {
		return okResponse{}, http.StatusBadRequest, err.Error()
	}
	err = s.mutateDocument(uid, func(document stateDocument) error {
		next := training.CloneWeekSchedule(week)
		pruneGhostSessions(next, document.routines().ids())
		return document.set("week", next)
	})
	if err != nil {
		return okResponse{}, http.StatusInternalServerError, "server error"
	}
	return okResponse{OK: true}, 0, ""
}

// POST /api/dayplan — set/clear one calendar day's plan. Body plan is
// {rest:true}, {sessions:[...]}, or null to clear.
func (s *Server) postDayPlan(w http.ResponseWriter, r *http.Request) {
	u := s.requireAnyAuth(w, r)
	if u == nil {
		return
	}
	var body struct {
		Iso  string               `json:"iso" validate:"required,datetime=2006-01-02"`
		Plan *training.MCPDayPlan `json:"plan"`
	}
	if !readValidatedJSON(w, r, &body) {
		return
	}
	payload, code, msg := s.applyDayPlan(u.ID, body.Iso, body.Plan)
	writeResult(w, payload, code, msg)
}

// applyDayPlan is the mutation core of POST /api/dayplan.
func (s *Server) applyDayPlan(uid, iso string, planInput *training.MCPDayPlan) (okResponse, int, string) {
	var entry training.MCPDayPlan
	if planInput != nil {
		entry = *planInput
		if !entry.Rest {
			entry.Sessions = slices.Clone(entry.Sessions)
			for i, session := range entry.Sessions {
				normalized, err := training.NormalizeDaySession(session)
				if err != nil {
					return okResponse{}, http.StatusBadRequest, err.Error()
				}
				entry.Sessions[i] = normalized
			}
		} else {
			entry.Sessions = nil
		}
	}

	err := s.mutateDocument(uid, func(document stateDocument) error {
		plan, err := training.DecodeDayPlanMap(document["dayPlan"])
		if err != nil {
			plan = training.DayPlanMap{}
		}
		if planInput == nil {
			delete(plan, iso)
		} else {
			plan[iso] = entry
		}
		return document.set("dayPlan", plan)
	})
	if err != nil {
		return okResponse{}, http.StatusInternalServerError, "server error"
	}
	return okResponse{OK: true}, 0, ""
}

// POST /api/bodyweight — upsert one dated weight entry, keep the log sorted
// by date ascending. Omitted date defaults to today (UTC).
func (s *Server) postBodyweight(w http.ResponseWriter, r *http.Request) {
	u := s.requireAnyAuth(w, r)
	if u == nil {
		return
	}
	var body struct {
		D string  `json:"d" validate:"omitempty,datetime=2006-01-02"`
		W float64 `json:"w" validate:"gte=20,lte=500"`
	}
	if !readValidatedJSON(w, r, &body) {
		return
	}
	payload, code, msg := s.applyBodyweight(u.ID, body.D, body.W)
	writeResult(w, payload, code, msg)
}

// applyBodyweight is the mutation core of POST /api/bodyweight.
func (s *Server) applyBodyweight(uid, iso string, weight float64) (bodyweightResponse, int, string) {
	if iso == "" {
		iso = time.Now().UTC().Format("2006-01-02")
	}
	weight = roundHundredths(weight)

	err := s.mutateDocument(uid, func(document stateDocument) error {
		measurements := document.measurements()
		index := slices.IndexFunc(measurements, func(measurement storedMeasurement) bool { return measurement.Date != nil && *measurement.Date == iso })
		if index >= 0 {
			fields, err := decodeStateDocument(measurements[index].raw)
			if err != nil {
				return err
			}
			if err := fields.set("w", weight); err != nil {
				return err
			}
			raw, err := json.Marshal(fields)
			if err != nil {
				return err
			}
			measurements[index].raw = raw
		} else {
			entry := training.MCPBodyweightEntry{D: iso, W: weight, T: new(time.Now().UnixMilli())}
			raw, err := json.Marshal(entry)
			if err != nil {
				return err
			}
			measurements = append(measurements, storedMeasurement{Date: new(iso), raw: raw})
		}
		slices.SortStableFunc(measurements, func(a, b storedMeasurement) int { return cmp.Compare(a.date(), b.date()) })
		return document.set("bodyweight", measurements)
	})
	if err != nil {
		return bodyweightResponse{}, http.StatusInternalServerError, "server error"
	}
	return bodyweightResponse{OK: true, Date: iso}, 0, ""
}

// POST /api/settings — allow-listed settings patch merged into the top level
// of the state blob. Field types and bounds are validated before merging.
func (s *Server) postSettings(w http.ResponseWriter, r *http.Request) {
	u := s.requireAnyAuth(w, r)
	if u == nil {
		return
	}
	var body struct {
		Settings *settingsPatch `json:"settings" validate:"required"`
	}
	if !readValidatedJSON(w, r, &body) {
		return
	}
	payload, code, msg := s.applySettings(u.ID, body.Settings)
	writeResult(w, payload, code, msg)
}

// applySettings is the mutation core of POST /api/settings.
func (s *Server) applySettings(uid string, patch *settingsPatch) (settingsResponse, int, string) {
	normalized := *patch
	for _, field := range []**float64{&normalized.RestSec, &normalized.TargetW} {
		if *field != nil {
			*field = new(roundHundredths(**field))
		}
	}
	clean, err := json.Marshal(normalized)
	if err != nil {
		return settingsResponse{}, http.StatusInternalServerError, "server error"
	}
	document, err := decodeStateDocument(clean)
	if err != nil {
		return settingsResponse{}, http.StatusInternalServerError, "server error"
	}
	if len(document) == 0 {
		return settingsResponse{}, http.StatusBadRequest, "no recognized settings in patch"
	}
	applied := slices.Sorted(maps.Keys(document))
	err = s.mutateDocument(uid, func(state stateDocument) error { maps.Copy(state, document); return nil })
	if err != nil {
		return settingsResponse{}, http.StatusInternalServerError, "server error"
	}
	return settingsResponse{OK: true, Applied: applied}, 0, ""
}

// Pointer fields distinguish an omitted setting from explicit false, zero or
// an empty string. Empty strings clear presentation preferences.
type settingsPatch struct {
	Unit      *string  `json:"unit,omitzero" validate:"omitempty,oneof=kg lb"`
	Effort    *string  `json:"effort,omitzero" validate:"omitempty,oneof=none rir rpe"`
	RestSec   *float64 `json:"restSec,omitzero" validate:"omitempty,gte=5,lte=600"`
	TargetW   *float64 `json:"targetW,omitzero" validate:"omitempty,gte=20,lte=500"`
	Sound     *bool    `json:"sound,omitzero"`
	KeepAwake *bool    `json:"keepAwake,omitzero"`
	Lang      *string  `json:"lang,omitzero" validate:"omitempty,max=24"`
	Theme     *string  `json:"theme,omitzero" validate:"omitempty,max=24"`
	Accent    *string  `json:"accent,omitzero" validate:"omitempty,max=24"`
	GIFSize   *string  `json:"gifSize,omitzero" validate:"omitempty,max=24"`
}
