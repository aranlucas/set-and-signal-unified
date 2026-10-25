package training

import (
	"encoding/json/jsontext"
	"math"
	"testing"
)

func TestFivefoldCrossUnitParity(t *testing.T) {
	for _, example := range []struct {
		name     string
		reps     []*float64
		want     float64
		failures int
	}{
		{"success", []*float64{new(5.), new(5.), new(5.), new(5.), new(5.)}, 140, 0},
		{"attempted zero", []*float64{new(5.), new(0.), new(5.), new(5.), new(5.)}, 120, 0},
		{"skipped", []*float64{new(5.), nil, new(5.), new(5.), new(5.)}, 135, 2},
	} {
		t.Run(example.name, func(t *testing.T) {
			cfg := MCPExConfig{ID: "0043", Sets: new(5.), Weight: new(convertPolicyLoad(135, "lb", "kg")), Inc: new(convertPolicyLoad(5, "lb", "kg")), Fivefold: &FivefoldPolicyState{Unit: "lb", Bar: 45, Failures: 2, AutoProgress: true, AutoDeload: true}}
			entry := MCPWorkoutEntry{ID: "0043"}
			for _, reps := range example.reps {
				entry.Sets = append(entry.Sets, MCPLoggedSet{Done: reps != nil, R: reps, W: cfg.Weight})
			}
			result := advanceFivefoldConfig(cfg, entry, "w1", "kg")
			if got := convertPolicyLoad(*result.Weight, "kg", "lb"); math.Abs(got-example.want) > 1e-8 || result.Fivefold.Failures != example.failures {
				t.Fatalf("got %.9f lb, failures %d; want %.9f/%d", got, result.Fivefold.Failures, example.want, example.failures)
			}
			replay := advanceFivefoldConfig(result, entry, "w1", "kg")
			if replay.Weight != result.Weight {
				t.Fatal("replay advanced twice")
			}
		})
	}
}

func TestFinalizeFivefoldReceiptsSurviveLaterCompletionsAndDeletion(t *testing.T) {
	st, repo := openTrainingRepositoryTest(t)
	if err := st.WriteState("u1", jsontext.Value(`{"unit":"kg","routines":[{"id":"fivefold-A","name":"A","prog":"fivefold","ex":[{"id":"0043","sets":1,"reps":5,"weight":100,"inc":2.5,"fivefold":{"unit":"kg","failures":0,"bar":20,"autoProgress":true,"autoDeload":true}}]}],"workouts":[{"id":"old","d":"2026-10-24","routineId":"fivefold-A","entries":[{"id":"0043","sets":[{"w":100,"r":5,"done":true}]}]},{"id":"new","d":"2026-10-25","routineId":"fivefold-A","entries":[{"id":"0043","sets":[{"w":102.5,"r":5,"done":true}]}]}]}`)); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"old", "new", "old"} {
		if err := repo.FinalizeWorkout("u1", id); err != nil {
			t.Fatal(err)
		}
	}
	data, err := repo.Load("u1")
	if err != nil {
		t.Fatal(err)
	}
	if *data.Routines[0].Ex[0].Weight != 105 {
		t.Fatalf("replayed older workout changed target: %+v", data.Routines[0].Ex[0])
	}
	if len(data.Workouts[0].ProgressionApplied) != 1 {
		t.Fatal("progression receipt missing")
	}
	if err := repo.Mutate("u1", nil, func(data *TrainingData) error { data.Workouts = nil; return nil }); err != nil {
		t.Fatal(err)
	}
	if err := repo.FinalizeWorkout("u1", "old"); err != nil {
		t.Fatal(err)
	}
	data, _ = repo.Load("u1")
	if len(data.Workouts) != 0 || *data.Routines[0].Ex[0].Weight != 105 {
		t.Fatal("finalization resurrected deleted record or replayed progression")
	}
}
