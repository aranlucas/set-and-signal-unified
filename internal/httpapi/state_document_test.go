package httpapi

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

func TestRESTMutationsPreserveClientOwnedJSON(t *testing.T) {
	e := newTestEnv(t)
	const future = `{"id":9007199254740993,"decimal":0.1234567890123456789}`
	const routine = `{"id":"kept","name":"Kept","future":{"id":9007199254740993},"ex":[{"id":"bench","future":true}]}`
	const workouts = `[{"d":"2026-09-01","future":{"id":9007199254740993}}]`
	seed := jsontext.Value(`{"future":` + future + `,"routines":[` + routine + `],"workouts":` + workouts + `,"bodyweight":[{"d":"2026-09-01","w":75,"t":9007199254740993,"device":{"future":true}}]}`)
	if err := e.st.WriteState("u1", seed); err != nil {
		t.Fatal(err)
	}
	for _, step := range []struct {
		path string
		body string
	}{
		{"/api/routine", `{"routine":{"id":"new","name":"New"}}`},
		{"/api/routines", `{"routines":[{"id":"extra","name":"Extra"}],"week":{"1":[{"routineId":"kept"}]}}`},
		{"/api/dayplan", `{"iso":"2026-09-02","plan":{"sessions":[{"routineId":"kept"}]}}`},
		{"/api/week", `{"week":{"2":[{"routineId":"kept"}]}}`},
		{"/api/bodyweight", `{"d":"2026-09-01","w":80}`},
		{"/api/settings", `{"settings":{"sound":false,"lang":""}}`},
		{"/api/routine/delete", `{"id":"new"}`},
	} {
		t.Run(step.path, func(t *testing.T) {
			response, body := e.post(step.path, step.body, "cookie")
			wantOK(t, response, body)
			raw, err := e.st.ReadState("u1")
			if err != nil {
				t.Fatal(err)
			}
			document, err := decodeStateDocument(raw)
			if err != nil {
				t.Fatal(err)
			}
			if string(document["future"]) != future || string(document["workouts"]) != workouts {
				t.Fatalf("client-owned data changed: %s", raw)
			}
			if got := document.routines()[0].raw; string(got) != routine {
				t.Fatalf("untouched routine changed: %s", got)
			}
			measurement, err := decodeStateDocument(document.measurements()[0].raw)
			if err != nil {
				t.Fatal(err)
			}
			if string(measurement["t"]) != "9007199254740993" || string(measurement["device"]) != `{"future":true}` {
				t.Fatalf("measurement metadata changed: %s", document["bodyweight"])
			}
		})
	}
	state := e.getState("cookie")
	if state["sound"] != false || state["lang"] != "" {
		t.Fatalf("explicit clearing values dropped: %v", state)
	}
	if measurement := state["bodyweight"].([]any)[0].(map[string]any); measurement["w"] != 80.0 {
		t.Fatalf("measurement not updated: %v", measurement)
	}
}

func TestAdminDrillDownPreservesJSONNumbers(t *testing.T) {
	e := newTestEnv(t)
	e.srv.Cfg.AdminUIDs = []string{"u1"}
	const seed = `{"workouts":[{"id":9007199254740993}],"bodyweight":[{"d":"2026-09-01","w":75,"future":0.1234567890123456789}]}`
	if err := e.st.WriteState("u1", jsontext.Value(seed)); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/admin/user?id=u1", nil)
	request.AddCookie(&http.Cookie{Name: "gymsid", Value: e.cookieVal("u1")})
	recorder := httptest.NewRecorder()
	Router(e.srv).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("drill-down = %d %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Workouts   jsontext.Value `json:"workouts"`
		Bodyweight jsontext.Value `json:"bodyweight"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if string(response.Workouts) != `[{"id":9007199254740993}]` || string(response.Bodyweight) != `[{"d":"2026-09-01","w":75,"future":0.1234567890123456789}]` {
		t.Fatalf("drill-down JSON changed: %s", recorder.Body.String())
	}
}

func TestPreparedProgramCanBeRetriedAgainstFreshState(t *testing.T) {
	prepared := typedPreparedProgram{
		routines: []training.MCPRoutine{{ID: "new", Name: "New", Ex: []training.MCPExConfig{}}},
		week:     training.WeekSchedule{"1": {{RoutineID: "concurrent"}}},
		hasWeek:  true,
	}
	first := stateDocument{}
	week, err := applyPreparedProgram(first, prepared, false)
	if err != nil || len(week) != 0 {
		t.Fatalf("initial state = %v, %v", week, err)
	}
	fresh, err := decodeStateDocument(jsontext.Value(`{"routines":[{"id":"concurrent","name":"Concurrent"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	week, err = applyPreparedProgram(fresh, prepared, false)
	if err != nil || len(week["1"]) != 1 || week["1"][0].RoutineID != "concurrent" {
		t.Fatalf("fresh state lost the concurrent routine: %v, %v", week, err)
	}
	if len(prepared.week["1"]) != 1 {
		t.Fatal("mutation changed its reusable input")
	}
}

func TestTypedInputsRejectInvalidJSONSyntax(t *testing.T) {
	e := newTestEnv(t)
	for _, input := range []struct{ path, body string }{
		{"/api/routine", `{"routine":{"name":"First","name":"Second"}}`},
		{"/api/settings", `{"settings":{"sound":true,"sound":false}}`},
	} {
		response, result := e.post(input.path, input.body, "cookie")
		if response.StatusCode != http.StatusBadRequest || errOf(result) != "bad json" {
			t.Fatalf("duplicate names accepted: %d %v", response.StatusCode, result)
		}
	}
}
