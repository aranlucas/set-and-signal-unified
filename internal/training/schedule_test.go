package training

import (
	"encoding/json/v2"
	"testing"
)

func TestRemovingFinalDaySessionSurvivesPersistence(t *testing.T) {
	data := TrainingData{Routines: []MCPRoutine{{ID: "a", Name: "A"}}, Week: WeekSchedule{"2": {{RoutineID: "a"}}}}
	if err := RemoveSessionFromDayPlan(&data, "2026-09-15", "a", nil); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := decodeTrainingData(raw)
	if err != nil {
		t.Fatalf("reload empty override: %v; state: %s", err, raw)
	}
	if got := Day(reloaded, "2026-09-15"); !got.Rest || len(got.Sessions) != 0 {
		t.Fatalf("removed session returned: %#v", got)
	}
	if err := AddSessionToDayPlan(&reloaded, "2026-09-15", MCPDaySession{RoutineID: "a"}); err != nil {
		t.Fatal(err)
	}
}
