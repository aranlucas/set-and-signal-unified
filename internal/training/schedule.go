package training

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"slices"
	"strings"

	"github.com/aranlucas/set-and-signal-unified/internal/validation"
)

// WeekSchedule is the persisted weekday → ordered sessions map.
type WeekSchedule map[string][]MCPDaySession

// DayPlanMap is the persisted ISO-date → day override map.
type DayPlanMap map[string]MCPDayPlan

// MCPDaySession is one planned workout on a calendar day or weekday slot.
type MCPDaySession struct {
	RoutineID string  `json:"routineId" jsonschema:"routine id for this session" validate:"required,max=40"`
	Start     *string `json:"start,omitempty" jsonschema:"optional local start time HH:MM" validate:"omitempty,datetime=15:04"`
	Label     *string `json:"label,omitempty" jsonschema:"optional coach-facing label" validate:"omitempty,max=80"`
}

// MCPDayPlan is a one-off override for an ISO calendar date.
// Rest=true means skip training; otherwise Sessions is the ordered plan for that day
// (including an empty list, which clears the weekly template for that date).
type MCPDayPlan struct {
	Rest     bool            `json:"rest,omitzero" jsonschema:"when true, the date is a rest day"`
	Sessions []MCPDaySession `json:"sessions" jsonschema:"ordered sessions when not a rest day" validate:"required_if=Rest false,dive"`
}

func cloneDaySessions(sessions []MCPDaySession) []MCPDaySession {
	if sessions == nil {
		return nil
	}
	out := make([]MCPDaySession, len(sessions))
	for i, session := range sessions {
		out[i] = MCPDaySession{RoutineID: session.RoutineID}
		if session.Start != nil {
			out[i].Start = new(*session.Start)
		}
		if session.Label != nil {
			out[i].Label = new(*session.Label)
		}
	}
	return out
}

func cloneWeekSchedule(week WeekSchedule) WeekSchedule {
	if week == nil {
		return nil
	}
	out := make(WeekSchedule, len(week))
	for day, sessions := range week {
		out[day] = cloneDaySessions(sessions)
	}
	return out
}

func cloneDayPlan(plan DayPlanMap) DayPlanMap {
	if plan == nil {
		return nil
	}
	out := make(DayPlanMap, len(plan))
	for day, entry := range plan {
		out[day] = MCPDayPlan{Rest: entry.Rest, Sessions: cloneDaySessions(entry.Sessions)}
	}
	return out
}

func daySessionsEqual(a, b []MCPDaySession) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].RoutineID != b[i].RoutineID {
			return false
		}
		if stringPtrValue(a[i].Start) != stringPtrValue(b[i].Start) {
			return false
		}
		if stringPtrValue(a[i].Label) != stringPtrValue(b[i].Label) {
			return false
		}
	}
	return true
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func weekSlotSessions(week WeekSchedule, weekday string) []MCPDaySession {
	if week == nil {
		return nil
	}
	return cloneDaySessions(week[weekday])
}

// resolveDaySessions returns the ordered sessions for iso, whether an override
// applied, and whether the day is explicitly rest.
func resolveDaySessions(view TrainingData, iso string) (sessions []MCPDaySession, override, rest bool) {
	weekday := weekdayKey(iso)
	weekSlots := weekSlotSessions(view.Week, weekday)
	if entry, ok := view.DayPlan[iso]; ok {
		override = true
		if entry.Rest {
			return nil, true, true
		}
		resolved := make([]MCPDaySession, 0, len(entry.Sessions))
		for _, session := range entry.Sessions {
			if _, found := findRoutineByID(view.Routines, session.RoutineID); found {
				resolved = append(resolved, session)
			}
		}
		// Invalid override ids are dropped; if nothing remains and the override
		// listed sessions, fall back to the weekly template.
		if len(resolved) == 0 && len(entry.Sessions) > 0 {
			return weekSlots, true, false
		}
		return cloneDaySessions(resolved), true, false
	}
	resolved := make([]MCPDaySession, 0, len(weekSlots))
	for _, session := range weekSlots {
		if _, found := findRoutineByID(view.Routines, session.RoutineID); found {
			resolved = append(resolved, session)
		}
	}
	return resolved, false, false
}

func normalizeDaySession(session MCPDaySession) (MCPDaySession, error) {
	session.RoutineID = strings.TrimSpace(session.RoutineID)
	for _, field := range []**string{&session.Start, &session.Label} {
		if *field != nil {
			value := strings.TrimSpace(**field)
			if value == "" {
				*field = nil
			} else {
				*field = new(value)
			}
		}
	}
	if err := validation.Validator.Struct(session); err != nil {
		return MCPDaySession{}, err
	}
	return session, nil
}

// ValidateSchedule enforces the current stored schedule shape through shared validation tags.
func ValidateSchedule(week WeekSchedule, dayPlan DayPlanMap) error {
	return validation.Validator.Struct(struct {
		Week    WeekSchedule `validate:"dive,keys,oneof=0 1 2 3 4 5 6,endkeys,required,dive"`
		DayPlan DayPlanMap   `validate:"dive,keys,datetime=2006-01-02,endkeys"`
	}{week, dayPlan})
}

func decodeWeekMap(value jsontext.Value) (WeekSchedule, error) {
	out := WeekSchedule{}
	if len(value) == 0 || value.Kind() == 'n' {
		return out, nil
	}
	if err := json.Unmarshal(value, &out); err != nil {
		return nil, err
	}
	return out, ValidateSchedule(out, nil)
}

func decodeDayPlanMap(value jsontext.Value) (DayPlanMap, error) {
	out := DayPlanMap{}
	if len(value) == 0 || value.Kind() == 'n' {
		return out, nil
	}
	if err := json.Unmarshal(value, &out); err != nil {
		return nil, err
	}
	return out, ValidateSchedule(nil, out)
}

func materializeDayPlan(view TrainingData, iso string) MCPDayPlan {
	sessions, _, rest := resolveDaySessions(view, iso)
	if rest {
		return MCPDayPlan{Rest: true}
	}
	return MCPDayPlan{Sessions: cloneDaySessions(sessions)}
}

func addSessionToDayPlan(data *TrainingData, iso string, session MCPDaySession) error {
	normalized, err := normalizeDaySession(session)
	if err != nil {
		return err
	}
	if _, found := findRoutineByID(data.Routines, normalized.RoutineID); !found {
		return fmt.Errorf("unknown routineId %q", normalized.RoutineID)
	}
	entry := materializeDayPlan(*data, iso)
	if entry.Rest {
		entry.Rest = false
		entry.Sessions = nil
	}
	entry.Sessions = append(entry.Sessions, normalized)
	if data.DayPlan == nil {
		data.DayPlan = DayPlanMap{}
	}
	data.DayPlan[iso] = entry
	return nil
}

func removeSessionFromDayPlan(data *TrainingData, iso, routineID string, index *int) error {
	routineID = strings.TrimSpace(routineID)
	if routineID == "" {
		return fmt.Errorf("routineId must not be empty")
	}
	entry := materializeDayPlan(*data, iso)
	if entry.Rest || len(entry.Sessions) == 0 {
		return fmt.Errorf("no sessions planned on %s", iso)
	}
	removeAt := -1
	if index != nil {
		if *index < 0 || *index >= len(entry.Sessions) {
			return fmt.Errorf("index out of range")
		}
		if entry.Sessions[*index].RoutineID != routineID {
			return fmt.Errorf("session at index %d is not routineId %q", *index, routineID)
		}
		removeAt = *index
	} else {
		for i, session := range entry.Sessions {
			if session.RoutineID == routineID {
				removeAt = i
				break
			}
		}
		if removeAt < 0 {
			return fmt.Errorf("routineId %q is not planned on %s", routineID, iso)
		}
	}
	entry.Sessions = slices.Delete(entry.Sessions, removeAt, removeAt+1)
	if data.DayPlan == nil {
		data.DayPlan = DayPlanMap{}
	}
	data.DayPlan[iso] = entry
	return nil
}
