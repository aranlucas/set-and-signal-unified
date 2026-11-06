package httpapi

import (
	"context"
	"errors"
	"testing"

	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

func mcpProgramContext(t *testing.T) context.Context {
	t.Helper()
	return context.WithValue(t.Context(), mcpCallerKey{}, "u1")
}

func TestProgramToolsSanitizeDiffAndPreserveState(t *testing.T) {
	e := newTestEnv(t)
	if err := e.st.WriteState("u1", []byte(`{"_ts":7,"note":"keep","routines":[{"id":"old","name":"Old","emoji":"","ex":[]}],"week":{"1":[{"routineId":"old"}]}}`)); err != nil {
		t.Fatal(err)
	}
	id := "new"
	input := training.MCPSetProgramInput{
		Routines: []training.MCPRoutineInput{{ID: &id, Name: "New", Ex: []training.MCPExConfigInput{{ID: "bench", Sets: new(3.0), Reps: new(5.0), Weight: new(60.0)}}}},
		Week: map[string][]training.MCPDaySession{
			"2": {{RoutineID: id}},
			"6": {{RoutineID: "ghost"}},
		},
	}
	_, preview, err := e.srv.previewProgramTool(mcpProgramContext(t), nil, training.MCPPreviewProgramInput{
		Routines: input.Routines,
		Week:     input.Week,
		Replace:  input.Replace,
	})
	if err != nil {
		t.Fatalf("previewProgramTool: %v", err)
	}
	if preview.Revision == nil || *preview.Revision != 7 || len(preview.Sanitized.Routines) != 1 || len(preview.Diff.AddedRoutines) != 1 || len(preview.Diff.RemovedRoutines) != 0 {
		t.Fatalf("typed preview = %#v", preview)
	}
	if len(preview.Proposed.Week) != 1 || len(preview.Proposed.Week["2"]) != 1 || preview.Proposed.Week["2"][0].RoutineID != "new" {
		t.Fatalf("typed proposed week = %#v", preview.Proposed.Week)
	}

	_, output, err := e.srv.setProgramTool(mcpProgramContext(t), nil, input)
	if err != nil || !output.OK || len(output.Routines) != 2 || output.Revision <= 7 {
		t.Fatalf("setProgramTool err=%v output=%#v", err, output)
	}
	state := e.getState("cookie")
	if state["note"] != "keep" {
		t.Fatalf("unrelated state lost: %#v", state)
	}
}

func TestTypedProgramApplyRejectsStaleRevision(t *testing.T) {
	e := newTestEnv(t)
	if err := e.st.WriteState("u1", []byte(`{"_ts":7,"routines":[]}`)); err != nil {
		t.Fatal(err)
	}
	stale := int64(6)
	_, _, err := e.srv.setProgramTool(mcpProgramContext(t), nil, training.MCPSetProgramInput{
		Routines:         []training.MCPRoutineInput{{Name: "Push"}},
		ExpectedRevision: &stale,
	})
	if !errors.Is(err, training.ErrTrainingDataRevisionConflict) {
		t.Fatalf("stale setProgramTool error = %v", err)
	}
	err = training.NewTrainingDataRepository(e.st).Mutate("u1", &stale, func(*training.TrainingData) error { return nil })
	if !errors.Is(err, training.ErrTrainingDataRevisionConflict) {
		t.Fatalf("repository conflict = %v", err)
	}
}

func TestTypedProgramFreshPreviewProvidesUsableZeroRevision(t *testing.T) {
	e := newTestEnv(t)
	input := training.MCPPreviewProgramInput{Routines: []training.MCPRoutineInput{{Name: "First"}}}
	_, preview, err := e.srv.previewProgramTool(mcpProgramContext(t), nil, input)
	if err != nil || preview.Revision == nil || *preview.Revision != 0 {
		t.Fatalf("fresh preview err=%v preview=%#v", err, preview)
	}
	_, output, err := e.srv.setProgramTool(mcpProgramContext(t), nil, training.MCPSetProgramInput{
		Routines: input.Routines, ExpectedRevision: preview.Revision,
	})
	if err != nil || !output.OK || output.Revision <= 0 {
		t.Fatalf("fresh apply err=%v output=%#v", err, output)
	}
}

func TestTypedProgramReplacePrunesReferencesButPreservesRest(t *testing.T) {
	e := newTestEnv(t)
	if err := e.st.WriteState("u1", []byte(`{"routines":[{"id":"old","name":"Old","emoji":"","ex":[]}],"week":{"1":[{"routineId":"old"}]},"dayPlan":{"2026-08-28":{"sessions":[{"routineId":"old"}]},"2026-08-29":{"rest":true}}}`)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.srv.setProgramTool(mcpProgramContext(t), nil, training.MCPSetProgramInput{
		Routines: []training.MCPRoutineInput{{Name: "New"}},
		Replace:  true,
	}); err != nil {
		t.Fatalf("replace: %v", err)
	}
	data, err := training.NewTrainingDataRepository(e.st).Load("u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Routines) != 1 || len(data.Week) != 0 || len(data.DayPlan) != 1 || !data.DayPlan["2026-08-29"].Rest {
		t.Fatalf("training data = %#v", data)
	}
}

func TestAddRemoveDaySessionTools(t *testing.T) {
	e := newTestEnv(t)
	if err := e.st.WriteState("u1", []byte(`{"routines":[{"id":"hip-rehab","name":"Hip","emoji":"","ex":[]},{"id":"fleet-feet-easy","name":"Run","emoji":"","ex":[]}],"week":{"2":[{"routineId":"hip-rehab"}]}}`)); err != nil {
		t.Fatal(err)
	}
	_, added, err := e.srv.addDaySessionTool(mcpProgramContext(t), nil, training.MCPAddDaySessionInput{
		Iso: "2026-09-15", RoutineID: "fleet-feet-easy", Start: new("18:00"),
	})
	if err != nil || !added.OK || len(added.Sessions) != 2 {
		t.Fatalf("add_day_session = %#v err=%v", added, err)
	}
	if added.Sessions[0].RoutineID != "hip-rehab" || added.Sessions[1].RoutineID != "fleet-feet-easy" {
		t.Fatalf("sessions = %#v", added.Sessions)
	}
	data, err := training.NewTrainingDataRepository(e.st).Load("u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Week["2"]) != 1 || data.Week["2"][0].RoutineID != "hip-rehab" {
		t.Fatalf("week replaced unexpectedly: %#v", data.Week)
	}
	_, removed, err := e.srv.removeDaySessionTool(mcpProgramContext(t), nil, training.MCPRemoveDaySessionInput{
		Iso: "2026-09-15", RoutineID: "fleet-feet-easy",
	})
	if err != nil || !removed.OK || len(removed.Sessions) != 1 || removed.Sessions[0].RoutineID != "hip-rehab" {
		t.Fatalf("remove_day_session = %#v err=%v", removed, err)
	}
}
