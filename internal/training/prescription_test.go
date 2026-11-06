package training

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func aptFullBody() MCPRoutine {
	prog := "linear"
	ex := func(id string) MCPExConfig {
		return MCPExConfig{ID: id, Sets: new(3.0), Reps: new(8.0), Weight: new(0.0)}
	}
	return MCPRoutine{
		ID: "apt-full-body", Name: "Apartment Full Body", Emoji: "dumbbell", Prog: &prog,
		Ex: []MCPExConfig{ex("1760"), ex("0289"), ex("0292"), ex("1459"), ex("0426")},
	}
}

func aptView(workouts ...MCPWorkout) TrainingData {
	return TrainingData{
		Unit: "lb", Routines: []MCPRoutine{aptFullBody()},
		Week: map[string][]MCPDaySession{
			"1": {{RoutineID: "apt-full-body"}},
			"3": {{RoutineID: "apt-full-body"}},
			"5": {{RoutineID: "apt-full-body"}},
		},
		Workouts: workouts,
	}
}

func gobletEntry(weight float64, reps ...float64) MCPWorkoutEntry {
	sets := make([]MCPLoggedSet, 0, len(reps))
	for _, r := range reps {
		sets = append(sets, MCPLoggedSet{Done: true, W: new(float64(weight)), R: new(float64(r))})
	}
	return MCPWorkoutEntry{
		ID: "1760", Target: &MCPExConfig{ID: "1760", Sets: new(3.0), Reps: new(8.0), Weight: new(float64(weight))}, Sets: sets,
	}
}

func TestLinearThreeByEightAddsFivePounds(t *testing.T) {
	view := aptView(MCPWorkout{D: "2026-08-24", Entries: []MCPWorkoutEntry{gobletEntry(155, 8, 8, 8)}})
	got := NextProgression(view, aptFullBody().Ex[0], aptFullBody())
	if got.Kind != "up" || got.Weight == nil || *got.Weight != 160 {
		t.Fatalf("next after clean 3×8 = %#v", got)
	}
}

func TestLinearMissHoldsWeight(t *testing.T) {
	view := aptView(MCPWorkout{D: "2026-08-24", Entries: []MCPWorkoutEntry{gobletEntry(155, 8, 8, 6)}})
	got := NextProgression(view, aptFullBody().Ex[0], aptFullBody())
	if got.Kind != "hold" || got.Weight == nil || *got.Weight != 155 {
		t.Fatalf("miss should hold: %#v", got)
	}
}

func TestLinearTwoMissesDeload(t *testing.T) {
	view := aptView(
		MCPWorkout{D: "2026-08-24", Entries: []MCPWorkoutEntry{gobletEntry(155, 8, 8, 5)}},
		MCPWorkout{D: "2026-08-26", Entries: []MCPWorkoutEntry{gobletEntry(155, 8, 8, 5)}},
	)
	got := NextProgression(view, aptFullBody().Ex[0], aptFullBody())
	if got.Kind != "deload" || got.Weight == nil || *got.Weight != 140 {
		t.Fatalf("two misses should deload: %#v", got)
	}
}

func TestWarmupsAreIgnoredForProgression(t *testing.T) {
	wu := true
	entry := gobletEntry(155, 8, 8, 8)
	entry.Sets = append([]MCPLoggedSet{{Done: true, W: new(95.0), R: new(8.0), WU: &wu}}, entry.Sets...)
	view := aptView(MCPWorkout{D: "2026-08-24", Entries: []MCPWorkoutEntry{entry}})
	got := NextProgression(view, aptFullBody().Ex[0], aptFullBody())
	if got.Kind != "up" || got.Weight == nil || *got.Weight != 160 {
		t.Fatalf("warmup should be ignored: %#v", got)
	}
}

func TestZeroLoggedSetsFallBackToTargetWeight(t *testing.T) {
	entry := gobletEntry(0, 8, 8, 8)
	entry.Target = &MCPExConfig{ID: "1760", Sets: new(3.0), Reps: new(8.0), Weight: new(155.0)}
	view := aptView(MCPWorkout{D: "2026-08-24", Entries: []MCPWorkoutEntry{entry}})
	got := NextProgression(view, aptFullBody().Ex[0], aptFullBody())
	if got.Kind != "up" || got.Weight == nil || *got.Weight != 160 {
		t.Fatalf("target weight should seed the load: %#v", got)
	}
}

func TestPrescribeTodayIsNotZeroWhenHistoryExists(t *testing.T) {
	view := aptView(MCPWorkout{D: "2026-08-24", Entries: []MCPWorkoutEntry{gobletEntry(155, 8, 8, 8)}})
	today := Day(view, "2026-08-28")
	if len(today.Sessions) != 1 || today.Sessions[0].Routine == nil || today.Sessions[0].Routine.ID != "apt-full-body" {
		t.Fatalf("today = %#v", today)
	}
	routine := today.Sessions[0].Routine
	if len(routine.Ex) != 5 || routine.Name != "Apartment Full Body" {
		t.Fatalf("routine wiped: %#v", routine)
	}
	if routine.Ex[0].Weight == nil || *routine.Ex[0].Weight != 160 {
		t.Fatalf("today goblet weight = %#v", routine.Ex[0].Weight)
	}
	if routine.Ex[1].ID != "0289" || routine.Ex[2].ID != "0292" {
		t.Fatalf("exercise order changed: %#v", routine.Ex)
	}
}

func TestPersistRoutineWorkingWeightsDoesNotWipeProgram(t *testing.T) {
	data := aptView()
	original := cloneRoutine(data.Routines[0])
	workout := MCPWorkout{
		D: "2026-08-24", RoutineID: new("apt-full-body"),
		Entries: []MCPWorkoutEntry{gobletEntry(155, 8, 8, 8)},
	}
	data.Workouts = append(data.Workouts, workout)
	persistRoutineWorkingWeights(&data, workout)
	got := data.Routines[0]
	if got.ID != original.ID || got.Name != original.Name || got.Emoji != original.Emoji {
		t.Fatalf("routine identity changed: %#v", got)
	}
	if len(got.Ex) != 5 {
		t.Fatalf("exercise list wiped: %#v", got.Ex)
	}
	for i, cfg := range original.Ex {
		if got.Ex[i].ID != cfg.ID || floatPointerValue(got.Ex[i].Sets) != 3 || floatPointerValue(got.Ex[i].Reps) != 8 {
			t.Fatalf("exercise %d changed beyond weight: before=%#v after=%#v", i, cfg, got.Ex[i])
		}
	}
	if got.Ex[0].Weight == nil || *got.Ex[0].Weight != 160 {
		t.Fatalf("goblet working weight = %#v", got.Ex[0].Weight)
	}
	if got.Ex[1].Weight == nil || *got.Ex[1].Weight != 0 {
		t.Fatalf("untouched lift should stay at 0: %#v", got.Ex[1].Weight)
	}
}

func TestSessionPrescriptionReportsLastAndNext(t *testing.T) {
	view := aptView(MCPWorkout{D: "2026-08-24", Entries: []MCPWorkoutEntry{gobletEntry(155, 8, 8, 8)}})
	got := SessionPrescription(view, "2026-08-28")
	if got.Rest || len(got.Sessions) != 1 || got.Sessions[0].RoutineName != "Apartment Full Body" {
		t.Fatalf("session = %#v", got)
	}
	if len(got.Sessions[0].Exercises) != 5 {
		t.Fatalf("exercises = %#v", got.Sessions[0].Exercises)
	}
	squat := got.Sessions[0].Exercises[0]
	if squat.ID != "1760" || squat.Decision != "increased" || squat.Last == nil || !squat.Last.Hit || squat.Last.Weight != 155 {
		t.Fatalf("goblet prescription = %#v", squat)
	}
	if squat.Next.Weight == nil || *squat.Next.Weight != 160 || squat.Next.Reps == nil || *squat.Next.Reps != 8 {
		t.Fatalf("goblet next = %#v", squat.Next)
	}
	if squat.Last.Sets == nil || reflect.DeepEqual(squat.Last.Sets, []string{}) {
		t.Fatalf("last sets missing: %#v", squat.Last.Sets)
	}
	if got.Sessions[0].Exercises[1].Decision != "first" {
		t.Fatalf("unlogged lift should be first: %#v", got.Sessions[0].Exercises[1])
	}
}

func TestLogExerciseSetsWritesNextWeight(t *testing.T) {
	data := aptView()
	workout, next, err := LogExerciseSets(&data, MCPLogExerciseSetsInput{
		ExerciseID: "1760", D: new("2026-08-24"), RoutineID: new("apt-full-body"),
		Sets: []MCPLogExerciseSet{{W: new(155.0), R: 8}, {W: new(155.0), R: 8}, {W: new(155.0), R: 8}},
	}, time.Date(2026, 8, 24, 18, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if next.Kind != "up" || next.Weight == nil || *next.Weight != 160 {
		t.Fatalf("next = %#v", next)
	}
	if len(workout.Entries) != 1 || len(workout.Entries[0].Sets) != 3 {
		t.Fatalf("workout = %#v", workout)
	}
	if data.Routines[0].Ex[0].Weight == nil || *data.Routines[0].Ex[0].Weight != 160 {
		t.Fatalf("routine weight = %#v", data.Routines[0].Ex[0])
	}
	if data.Routines[0].ID != "apt-full-body" || len(data.Routines[0].Ex) != 5 {
		t.Fatalf("routine wiped: %#v", data.Routines[0])
	}
}

func TestLogExerciseSetsRequiresWeightOnLoadedLifts(t *testing.T) {
	data := aptView()
	_, _, err := LogExerciseSets(&data, MCPLogExerciseSetsInput{
		ExerciseID: "1760", D: new("2026-08-24"),
		Sets: []MCPLogExerciseSet{{W: new(0.0), R: 8}, {W: new(0.0), R: 8}, {W: new(0.0), R: 8}},
	}, time.Now())
	if err == nil {
		t.Fatal("expected weight required error")
	}
}

func TestValidateLoadedWorkingSetsRejectsZero(t *testing.T) {
	err := validateLoadedWorkingSets(MCPWorkout{Entries: []MCPWorkoutEntry{gobletEntry(0, 8, 8, 8)}})
	if err == nil {
		t.Fatal("expected rejection of 0×8 working sets")
	}
}

func TestBuildHistoryIncludesLastWeightAndHit(t *testing.T) {
	view := aptView(MCPWorkout{
		ID: "w1", D: "2026-08-24", Name: "Apartment Full Body", Vol: 3720,
		Entries: []MCPWorkoutEntry{gobletEntry(155, 8, 8, 8)},
	})
	got := BuildHistory(view, HistoryQuery{Limit: 10})
	if len(got) != 1 || len(got[0].Entries) != 1 {
		t.Fatalf("history = %#v", got)
	}
	entry := got[0].Entries[0]
	if !reflect.DeepEqual(entry.Sets, []string{"155×8", "155×8", "155×8"}) {
		t.Fatalf("sets = %#v", entry.Sets)
	}
	if entry.LastWeight == nil || *entry.LastWeight != 155 || entry.Hit == nil || !*entry.Hit {
		t.Fatalf("history entry = %#v", entry)
	}
}

func TestPutWorkoutPersistsNextWorkingWeight(t *testing.T) {
	_, repo := openTrainingRepositoryTest(t)
	if err := repo.Mutate("u1", nil, func(data *TrainingData) error {
		*data = aptView()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	workout := MCPWorkout{
		ID: "w1", D: "2026-08-24", Name: "Apartment Full Body",
		RoutineID: new("apt-full-body"),
		Entries:   []MCPWorkoutEntry{gobletEntry(155, 8, 8, 8)},
		PRs:       []string{},
	}
	if _, err := repo.PutWorkout("u1", workout); err != nil {
		t.Fatal(err)
	}
	got, err := repo.Load("u1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Routines[0].ID != "apt-full-body" || len(got.Routines[0].Ex) != 5 {
		t.Fatalf("routine wiped: %#v", got.Routines)
	}
	if got.Routines[0].Ex[0].Weight == nil || *got.Routines[0].Ex[0].Weight != 160 {
		t.Fatalf("stored working weight = %#v", got.Routines[0].Ex[0])
	}
}

func TestLogExerciseSetsSeparatesRepeatedRoutineSessions(t *testing.T) {
	data := aptView()
	data.Workouts = nil
	now := time.Date(2026, 8, 24, 18, 0, 0, 0, time.UTC)
	input := MCPLogExerciseSetsInput{ExerciseID: "1760", D: new("2026-08-24"), RoutineID: new("apt-full-body"), WorkoutID: new("morning"), Sets: []MCPLogExerciseSet{{W: new(155.0), R: 8}}}
	if _, _, err := LogExerciseSets(&data, input, now); err != nil {
		t.Fatal(err)
	}
	input.WorkoutID = new("evening")
	input.Sets = []MCPLogExerciseSet{{W: new(150.0), R: 6}}
	if _, _, err := LogExerciseSets(&data, input, now); err != nil {
		t.Fatal(err)
	}
	// Retrying the second session corrects that session rather than creating a third.
	if _, _, err := LogExerciseSets(&data, input, now); err != nil {
		t.Fatal(err)
	}
	if len(data.Workouts) != 2 || data.Workouts[0].ID != "morning" || data.Workouts[1].ID != "evening" {
		t.Fatalf("sessions: %#v", data.Workouts)
	}
	if *data.Workouts[0].Entries[0].Sets[0].W != 155 || *data.Workouts[1].Entries[0].Sets[0].W != 150 {
		t.Fatal("session results were merged")
	}
	input.D = new("2026-08-25")
	if _, _, err := LogExerciseSets(&data, input, now); err == nil {
		t.Fatal("accepted a workout id from another day")
	}
}

func TestWorkoutSelectionDoesNotMergeUnassignedLogsIntoRoutine(t *testing.T) {
	workouts := []MCPWorkout{{ID: "existing", D: "2026-08-24", RoutineID: new("a")}}
	if _, found := findSameDayWorkout(workouts, "2026-08-24", ""); found {
		t.Fatal("unassigned exercise selected unrelated routine")
	}
	for _, id := range []string{"", " ", strings.Repeat("a", 41)} {
		if _, _, err := workoutForExerciseSets(workouts, "2026-08-24", "a", &id); err == nil {
			t.Fatalf("accepted id %q", id)
		}
	}
	if _, _, err := workoutForExerciseSets(workouts, "2026-08-24", "b", new("existing")); err == nil {
		t.Fatal("accepted id from another routine")
	}
}
