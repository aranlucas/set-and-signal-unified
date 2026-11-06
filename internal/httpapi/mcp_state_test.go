package httpapi

import (
	"encoding/json/v2"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

func TestTrainingDataGraphHasNoInterfaceFields(t *testing.T) {
	assertMCPStateConcrete(t, reflect.TypeFor[training.MCPCustomExercise](), "MCPCustomExercise")
	assertMCPStateConcrete(t, reflect.TypeFor[training.MCPExWeightHint](), "MCPExWeightHint")
	assertMCPStateConcrete(t, reflect.TypeFor[training.MCPExerciseConfigRef](), "MCPExerciseConfigRef")
	assertMCPStateConcrete(t, reflect.TypeFor[training.TrainingData](), "TrainingData")
}

func assertMCPStateConcrete(t *testing.T, typ reflect.Type, path string) {
	t.Helper()
	for typ.Kind() == reflect.Pointer {
		typ = typ.Elem()
	}
	switch typ.Kind() {
	case reflect.Interface:
		t.Fatalf("MCP state field %s contains interface type %s", path, typ)
	case reflect.Map:
		assertMCPStateConcrete(t, typ.Key(), path+" map key")
		assertMCPStateConcrete(t, typ.Elem(), path+" map value")
	case reflect.Slice, reflect.Array:
		assertMCPStateConcrete(t, typ.Elem(), path+" element")
	case reflect.Struct:
		for field := range typ.Fields() {
			if field.PkgPath != "" { // unexported implementation fields are not wire fields
				continue
			}
			assertMCPStateConcrete(t, field.Type, path+"."+field.Name)
		}
	}
}

func TestReadMCPStateAppliesDefaults(t *testing.T) {
	e := newTestEnv(t)
	if err := e.st.WriteState("u1", []byte(`{"routines":[{"id":"r1","name":"Push","ex":[{"id":"bench","sets":3}]}]}`)); err != nil {
		t.Fatal(err)
	}

	view, err := e.srv.loadTrainingData("u1")
	if err != nil {
		t.Fatal(err)
	}
	if view.Unit != "lb" {
		t.Fatalf("default unit = %q, want lb", view.Unit)
	}
	if view.TargetW != nil || view.Revision != 0 {
		t.Fatalf("optional fields = target %v revision %d", view.TargetW, view.Revision)
	}
	if len(view.Routines) != 1 || len(view.Routines[0].Ex) != 1 {
		t.Fatalf("routines = %#v", view.Routines)
	}
	if view.Bodyweight == nil || view.Week == nil || view.DayPlan == nil || view.ExWeights == nil || view.Workouts == nil || view.CustomEx == nil {
		t.Fatalf("collections were not normalized: %#v", view)
	}
	if len(view.Bodyweight) != 0 || len(view.Week) != 0 || len(view.DayPlan) != 0 || len(view.ExWeights) != 0 || len(view.Workouts) != 0 || len(view.CustomEx) != 0 {
		t.Fatalf("collection defaults are not empty: %#v", view)
	}
}

func TestReadMCPStateDecodesTypedTrainingData(t *testing.T) {
	e := newTestEnv(t)
	state := map[string]any{
		"unit": "kg", "targetW": 80.5, "_ts": 42,
		"bodyweight": []any{map[string]any{"d": "2026-08-20", "w": 81.2}},
		"week":       training.WeekSchedule{"1": {{RoutineID: "r1"}}, "2": {}},
		"dayPlan":    training.DayPlanMap{"2026-08-28": {Sessions: []training.MCPDaySession{{RoutineID: "r1"}}}, "2026-08-29": {Rest: true}},
		"exWeights":  map[string]any{"bench": map[string]any{"w": 100, "d": "2026-08-20"}},
		"customEx":   []any{map[string]any{"id": "custom-1", "n": "Cable Press", "bp": "chest", "desc": "home", "custom": true}},
		"routines":   []any{map[string]any{"id": "r1", "name": "Push", "emoji": "bolt", "ex": []any{map[string]any{"id": "bench", "sets": 3, "reps": 5}}}},
		"workouts":   []any{map[string]any{"id": "w1", "d": "2026-08-20", "start": 1, "end": 2, "name": "Push", "entries": []any{}, "prs": []any{}, "vol": 0}},
	}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.st.WriteState("u1", raw); err != nil {
		t.Fatal(err)
	}

	view, err := e.srv.loadTrainingData("u1")
	if err != nil {
		t.Fatal(err)
	}
	if view.Unit != "kg" || view.TargetW == nil || *view.TargetW != 80.5 || view.Revision != 42 {
		t.Fatalf("typed scalar state = %#v", view)
	}
	if got := view.Week["2"]; len(got) != 0 {
		t.Fatalf("empty week = %v, want empty", got)
	}
	if view.ExWeights["bench"].W != 100 || view.CustomEx[0].Desc != "home" || !view.CustomEx[0].Custom {
		t.Fatalf("typed nested state = %#v", view)
	}
	if !view.DayPlan["2026-08-29"].Rest {
		t.Fatalf("dayPlan = %#v", view.DayPlan)
	}
	if len(view.Week["1"]) != 1 || view.Week["1"][0].RoutineID != "r1" {
		t.Fatalf("week = %#v", view.Week)
	}
	if len(view.DayPlan["2026-08-28"].Sessions) != 1 || view.DayPlan["2026-08-28"].Sessions[0].RoutineID != "r1" {
		t.Fatalf("dayPlan = %#v", view.DayPlan)
	}
}

func TestLoadTrainingDataRejectsMalformedJSON(t *testing.T) {
	e := newTestEnv(t)
	if _, err := e.st.DB.Exec(
		`INSERT INTO user_state (user_id, state, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
		"u1", `{"unit":`,
	); err != nil {
		t.Fatal(err)
	}
	_, err := e.srv.loadTrainingData("u1")
	if err == nil || !strings.Contains(err.Error(), "load training data") {
		t.Fatalf("read malformed state error = %v", err)
	}
}

func TestTrainingDataLookupsAreDeterministicAndReportAmbiguity(t *testing.T) {
	name := "Push"
	view := training.TrainingData{Routines: []training.MCPRoutine{
		{ID: "r2", Name: name, Ex: []training.MCPExConfig{{ID: "bench"}}},
		{ID: "r1", Name: name, Ex: []training.MCPExConfig{{ID: "bench"}}},
		{ID: "push-id", Name: "Different", Ex: []training.MCPExConfig{{ID: "squat"}}},
	}}

	if _, err := view.FindRoutine(name); !errors.Is(err, training.ErrTrainingDataAmbiguous) {
		t.Fatalf("duplicate routine name error = %v", err)
	} else if !strings.Contains(err.Error(), "r1, r2") {
		t.Fatalf("routine ambiguity is not deterministic = %v", err)
	}
	routine, err := view.FindRoutine("push-id")
	if err != nil || routine.ID != "push-id" {
		t.Fatalf("exact routine id = %#v, %v", routine, err)
	}
	if _, err := view.FindRoutine("missing"); !errors.Is(err, training.ErrTrainingDataNotFound) {
		t.Fatalf("missing routine error = %v", err)
	}

	if _, err := view.FindExerciseConfig("bench"); !errors.Is(err, training.ErrTrainingDataAmbiguous) {
		t.Fatalf("duplicate exercise error = %v", err)
	} else if !strings.Contains(err.Error(), "r1, r2") {
		t.Fatalf("exercise ambiguity is not deterministic = %v", err)
	}
	ref, err := view.FindExerciseConfig("squat")
	if err != nil || ref.RoutineID != "push-id" || ref.Config.ID != "squat" {
		t.Fatalf("unique exercise config = %#v, %v", ref, err)
	}
	if _, err := view.FindExerciseConfig(""); !errors.Is(err, training.ErrTrainingDataNotFound) {
		t.Fatalf("empty exercise error = %v", err)
	}
}
