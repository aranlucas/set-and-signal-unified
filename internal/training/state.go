package training

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

// MCPCustomExercise is the persisted custom-exercise shape used by the web
// app.  It is deliberately separate from exercises.Exercise: desc and custom
// are storage metadata, while the catalog type is the smaller search shape.
type MCPCustomExercise struct {
	ID     string `json:"id"`
	N      string `json:"n"`
	BP     string `json:"bp"`
	Desc   string `json:"desc,omitempty"`
	Custom bool   `json:"custom,omitzero"`
	EQ     string `json:"eq,omitempty"`
	TG     string `json:"tg,omitempty"`
}

// MCPExWeightHint is the last confirmed working weight for an exercise.
// Older state blobs may omit this map entirely; loadTrainingData normalizes it.
type MCPExWeightHint struct {
	W float64 `json:"w"`
	D string  `json:"d"`
}

// TrainingData is the typed durable training portion of the persisted Set & Signal
// document. The complete application state contains device-local and
// presentation settings that MCP must not expose; this view contains only
// durable training data needed by MCP tools.
//
// Keep this graph closed. In particular, do not add map[string]any or
// interface-valued fields here: this type is intentionally safe to pass
// through typed MCP producers and to use as the source for output DTOs.
type TrainingData struct {
	FivefoldNext string                     `json:"fivefoldNext,omitempty"`
	Unit         string                     `json:"unit"`
	TargetW      *float64                   `json:"targetW,omitzero"`
	Bodyweight   []MCPBodyweightEntry       `json:"bodyweight"`
	Routines     []MCPRoutine               `json:"routines"`
	Week         WeekSchedule               `json:"week"`
	DayPlan      DayPlanMap                 `json:"dayPlan"`
	ExWeights    map[string]MCPExWeightHint `json:"exWeights"`
	Workouts     []MCPWorkout               `json:"workouts"`
	CustomEx     []MCPCustomExercise        `json:"customEx"`
	Revision     int64                      `json:"_ts,omitzero"`
}

// Errors returned by the deterministic state lookups below. Callers can use
// errors.Is while the message still identifies the query and candidates.
var (
	ErrTrainingDataNotFound  = errors.New("training data item not found")
	ErrTrainingDataAmbiguous = errors.New("training data item is ambiguous")
)

func normalizeTrainingData(view *TrainingData) {
	if view.Unit != "kg" && view.Unit != "lb" {
		view.Unit = "lb"
	}
	if view.Bodyweight == nil {
		view.Bodyweight = []MCPBodyweightEntry{}
	}
	if view.Routines == nil {
		view.Routines = []MCPRoutine{}
	}
	if view.Week == nil {
		view.Week = WeekSchedule{}
	}
	if view.DayPlan == nil {
		view.DayPlan = DayPlanMap{}
	}
	if view.ExWeights == nil {
		view.ExWeights = map[string]MCPExWeightHint{}
	}
	if view.Workouts == nil {
		view.Workouts = []MCPWorkout{}
	}
	if view.CustomEx == nil {
		view.CustomEx = []MCPCustomExercise{}
	}
}

// FindRoutine resolves an id first, then a case-insensitive name. Name
// matches are only accepted when unique; silently choosing the first matching
// routine would make an agent edit the wrong program after a user rename.
func (s TrainingData) FindRoutine(query string) (MCPRoutine, error) {
	query = strings.TrimSpace(query)
	for _, routine := range s.Routines {
		if routine.ID == query {
			return routine, nil
		}
	}
	if query == "" {
		return MCPRoutine{}, fmt.Errorf("%w: routine %q", ErrTrainingDataNotFound, query)
	}

	needle := strings.ToLower(query)
	matches := make([]MCPRoutine, 0, 1)
	for _, routine := range s.Routines {
		if strings.ToLower(strings.TrimSpace(routine.Name)) == needle {
			matches = append(matches, routine)
		}
	}
	switch len(matches) {
	case 0:
		return MCPRoutine{}, fmt.Errorf("%w: routine %q", ErrTrainingDataNotFound, query)
	case 1:
		return matches[0], nil
	default:
		return MCPRoutine{}, fmt.Errorf("%w: routine %q matches %s", ErrTrainingDataAmbiguous, query, routineCandidates(matches))
	}
}

// MCPExerciseConfigRef identifies an exercise config without losing which
// routine supplied it. Exercise ids can legitimately occur in multiple
// routines, so FindExerciseConfig reports that ambiguity instead of relying
// on persisted slice order.
type MCPExerciseConfigRef struct {
	RoutineID   string      `json:"routineId"`
	RoutineName string      `json:"routineName"`
	Config      MCPExConfig `json:"config"`
}

// FindExerciseConfig returns the unique planned config for an exercise id.
func (s TrainingData) FindExerciseConfig(exerciseID string) (MCPExerciseConfigRef, error) {
	exerciseID = strings.TrimSpace(exerciseID)
	matches := make([]MCPExerciseConfigRef, 0, 1)
	if exerciseID != "" {
		for _, routine := range s.Routines {
			for _, config := range routine.Ex {
				if config.ID == exerciseID {
					matches = append(matches, MCPExerciseConfigRef{
						RoutineID: routine.ID, RoutineName: routine.Name, Config: config,
					})
				}
			}
		}
	}
	switch len(matches) {
	case 0:
		return MCPExerciseConfigRef{}, fmt.Errorf("%w: exercise config %q", ErrTrainingDataNotFound, exerciseID)
	case 1:
		return matches[0], nil
	default:
		return MCPExerciseConfigRef{}, fmt.Errorf("%w: exercise config %q matches %s", ErrTrainingDataAmbiguous, exerciseID, configCandidates(matches))
	}
}

func routineCandidates(matches []MCPRoutine) string {
	ids := make([]string, 0, len(matches))
	for _, match := range matches {
		ids = append(ids, match.ID)
	}
	slices.Sort(ids)
	return strings.Join(ids, ", ")
}

func configCandidates(matches []MCPExerciseConfigRef) string {
	candidates := make([]string, 0, len(matches))
	for _, match := range matches {
		candidates = append(candidates, match.RoutineID)
	}
	slices.Sort(candidates)
	return strings.Join(candidates, ", ")
}
