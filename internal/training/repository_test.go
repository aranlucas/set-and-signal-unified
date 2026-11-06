package training

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

func openTrainingRepositoryTest(t *testing.T) (*store.Store, *TrainingDataRepository) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	if err := st.CreateUser(store.User{ID: "u1"}); err != nil {
		_ = st.DB.Close()
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _ = st.DB.Close() })
	return st, NewTrainingDataRepository(st)
}

func TestTrainingDataRepositoryLoadNormalizesTypedData(t *testing.T) {
	st, repo := openTrainingRepositoryTest(t)
	if err := st.WriteState("u1", jsontext.Value(`{"unit":"kg","routines":[{"id":"r1","name":"Push","ex":null}],"unknown":{"keep":true},"_ts":42}`)); err != nil {
		t.Fatal(err)
	}

	got, err := repo.Load("u1")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got.Unit != "kg" || got.Revision != 42 || len(got.Routines) != 1 || got.Routines[0].ID != "r1" {
		t.Fatalf("unexpected typed data: %+v", got)
	}
	if got.Bodyweight == nil || got.Workouts == nil || got.ExWeights == nil {
		t.Fatalf("Load did not normalize collections: %+v", got)
	}
}

func TestDecodeTrainingDataDocumentBoundary(t *testing.T) {
	for _, raw := range []string{"", "null", " {} ", `{"future":{"id":9007199254740993}}`} {
		data, err := decodeTrainingData(jsontext.Value(raw))
		if err != nil || data.Workouts == nil || data.Week == nil {
			t.Errorf("decode %q: unnormalized data or error: %+v, %v", raw, data, err)
		}
	}
	for _, raw := range []string{"[]", "42", `"text"`, "true", `{"workouts":42}`, `{"unit":"kg","unit":"lb"}`} {
		if _, err := decodeTrainingData(jsontext.Value(raw)); err == nil {
			t.Errorf("accepted invalid training document: %s", raw)
		}
	}
}

func TestTrainingDataRepositoryMutationPreservesUnknownFields(t *testing.T) {
	st, repo := openTrainingRepositoryTest(t)
	if err := st.WriteState("u1", jsontext.Value(`{"unit":"lb","targetW":80,"fivefoldNext":"B","futureInteger":9007199254740993,"settings":{"theme":"dark"},"future":[1,{"x":2}],"routines":[]}`)); err != nil {
		t.Fatal(err)
	}
	if err := repo.Mutate("u1", nil, func(data *TrainingData) error {
		data.Unit = "kg"
		data.TargetW = nil
		data.FivefoldNext = ""
		data.Routines = append(data.Routines, MCPRoutine{ID: "r1", Name: "Pull", Ex: []MCPExConfig{}})
		return nil
	}); err != nil {
		t.Fatalf("Mutate: %v", err)
	}

	raw, err := st.ReadState("u1")
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]jsontext.Value
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("stored JSON: %v", err)
	}
	var settings map[string]string
	if err := json.Unmarshal(doc["settings"], &settings); err != nil || settings["theme"] != "dark" {
		t.Fatalf("unknown settings changed: %s", doc["settings"])
	}
	if string(doc["future"]) != `[1,{"x":2}]` {
		t.Fatalf("unknown future field changed: %s", doc["future"])
	}
	if _, ok := doc["fivefoldNext"]; ok {
		t.Fatalf("cleared next session was retained: %s", doc["fivefoldNext"])
	}
	if string(doc["futureInteger"]) != "9007199254740993" {
		t.Fatalf("unknown integer changed: %s", doc["futureInteger"])
	}
	if _, ok := doc["targetW"]; ok {
		t.Fatalf("cleared optional field was retained: %s", doc["targetW"])
	}
	loaded, err := repo.Load("u1")
	if err != nil || loaded.Unit != "kg" || len(loaded.Routines) != 1 {
		t.Fatalf("typed mutation not persisted: %+v, %v", loaded, err)
	}
}

func TestTrainingDataRepositoryRevisionConflictIsTyped(t *testing.T) {
	st, repo := openTrainingRepositoryTest(t)
	if err := st.WriteState("u1", jsontext.Value(`{"unit":"lb","_ts":7}`)); err != nil {
		t.Fatal(err)
	}
	expected := int64(6)
	err := repo.Mutate("u1", &expected, func(data *TrainingData) error {
		data.Unit = "kg"
		return nil
	})
	conflict, ok := errors.AsType[*RevisionConflictError](err)
	if !ok || conflict.Expected != 6 || conflict.Actual != 7 {
		t.Fatalf("expected typed conflict, got %T: %v", err, err)
	}
	sentinelCheck := ErrTrainingDataRevisionConflict
	if !errors.Is(err, sentinelCheck) {
		t.Fatalf("errors.Is conflict = false: %v", err)
	}
	got, err := repo.Load("u1")
	if err != nil || got.Unit != "lb" {
		t.Fatalf("conflicting mutation changed state: %+v, %v", got, err)
	}
}

func TestTrainingDataRepositoryMutationsAreAtomic(t *testing.T) {
	st, repo := openTrainingRepositoryTest(t)
	if err := st.WriteState("u1", jsontext.Value(`{"exWeights":{}}`)); err != nil {
		t.Fatal(err)
	}

	const workers = 16
	var wg sync.WaitGroup
	errs := make(chan error, workers)
	for i := range workers {
		wg.Go(func() {
			key := fmt.Sprintf("ex-%d", i)
			if err := repo.Mutate("u1", nil, func(data *TrainingData) error {
				data.ExWeights[key] = MCPExWeightHint{W: float64(i + 1), D: "2026-08-28"}
				return nil
			}); err != nil {
				errs <- err
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	got, err := repo.Load("u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.ExWeights) != workers {
		t.Fatalf("lost concurrent typed updates: got %d, want %d", len(got.ExWeights), workers)
	}
}

func TestTrainingDataRepositoryPutBodyweightUpsertsAndSorts(t *testing.T) {
	st, repo := openTrainingRepositoryTest(t)
	if err := st.WriteState("u1", jsontext.Value(`{"unit":"kg","bodyweight":[{"d":"2026-08-28","w":80}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutBodyweight("u1", "2026-08-27", 81); err != nil {
		t.Fatal(err)
	}
	got, err := repo.PutBodyweight("u1", "2026-08-28", 79.5)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Bodyweight) != 2 || got.Bodyweight[0].D != "2026-08-27" || got.Bodyweight[1].W != 79.5 {
		t.Fatalf("bodyweight = %#v", got.Bodyweight)
	}
}

func TestTrainingDataRepositoryPutWorkoutUpsertsTypedWorkout(t *testing.T) {
	_, repo := openTrainingRepositoryTest(t)
	first := MCPWorkout{ID: " workout-1 ", D: "2026-08-28", Name: "", Entries: []MCPWorkoutEntry{}, PRs: []string{}}
	stored, err := repo.PutWorkout("u1", first)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ID != "workout-1" || stored.Name != "Workout" {
		t.Fatalf("stored = %#v", stored)
	}
	stored.Name = "Pull"
	if _, err := repo.PutWorkout("u1", stored); err != nil {
		t.Fatal(err)
	}
	data, err := repo.Load("u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Workouts) != 1 || data.Workouts[0].Name != "Pull" {
		t.Fatalf("workouts = %#v", data.Workouts)
	}
}

func TestTrainingMutationPreservesCustomExerciseSnapshot(t *testing.T) {
	st, repo := openTrainingRepositoryTest(t)
	if err := st.WriteState("u1", jsontext.Value(`{"workouts":[{"id":"w1","d":"2026-09-01","start":1,"end":2,"name":"Custom","entries":[{"id":"deleted","sets":[],"muscleSnapshot":{"n":"Cable Press","bp":"chest","muscleWeights":{"chest":1,"triceps":0.5}}}],"prs":[],"vol":0}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutBodyweight("u1", "2026-09-01", 80); err != nil {
		t.Fatal(err)
	}
	data, err := repo.Load("u1")
	if err != nil {
		t.Fatal(err)
	}
	snapshot := data.Workouts[0].Entries[0].MuscleSnapshot
	if snapshot == nil || snapshot.N != "Cable Press" || snapshot.BP != "chest" || snapshot.MuscleWeights["triceps"] != 0.5 {
		t.Fatalf("custom exercise snapshot changed: %#v", snapshot)
	}
}
