package httpapi

import (
	"encoding/json/jsontext"
	"net/http"
	"strings"
	"testing"

	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

func TestInvalidRequestsLeaveStateUnchanged(t *testing.T) {
	e := newTestEnv(t)
	const seed = `{"routines":[{"id":"existing","name":"Existing","ex":[]}],"sound":true,"future":9007199254740993}`
	if err := e.st.WriteState("u1", jsontext.Value(seed)); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ name, path, body, errorField string }{
		{"exercise range", "/api/routine", `{"routine":{"name":"Push","ex":[{"id":"bench","sets":99}]}}`, "sets"},
		{"exercise enum", "/api/routine", `{"routine":{"name":"Push","ex":[{"id":"bench","mode":"bogus"}]}}`, "mode"},
		{"routine enum", "/api/routine", `{"routine":{"name":"Push","prog":"bogus"}}`, "prog"},
		{"empty trimmed name", "/api/routine", `{"routine":{"name":"   "}}`, "name"},
		{"empty trimmed exercise id", "/api/routine", `{"routine":{"name":"Push","ex":[{"id":"   "}]}}`, "id"},
		{"batch is atomic", "/api/routines", `{"replace":true,"routines":[{"name":"Valid"},{"name":"Invalid","ex":[{"id":"bench","weight":-1}]}]}`, "weight"},
		{"duplicate ids", "/api/routines", `{"routines":[{"name":"Push"},{"name":"Push"}]}`, "duplicate"},
		{"empty batch", "/api/routines", `{"routines":[]}`, "min"},
		{"session time", "/api/week", `{"week":{"1":[{"routineId":"existing","start":"25:00"}]}}`, "start"},
		{"missing day sessions", "/api/dayplan", `{"iso":"2026-09-01","plan":{}}`, "sessions"},
		{"invalid calendar date", "/api/dayplan", `{"iso":"2026-02-30","plan":{"rest":true}}`, "iso"},
		{"obsolete string plan", "/api/dayplan", `{"iso":"2026-09-01","plan":"rest"}`, "bad json"},
		{"settings range", "/api/settings", `{"settings":{"sound":false,"restSec":601}}`, "restSec"},
		{"settings enum", "/api/settings", `{"settings":{"unit":"stone"}}`, "unit"},
		{"settings length", "/api/settings", `{"settings":{"theme":"` + strings.Repeat("x", 25) + `"}}`, "theme"},
		{"settings numeric string", "/api/settings", `{"settings":{"targetW":"80"}}`, "bad json"},
		{"unknown nested field", "/api/routine", `{"routine":{"name":"Push","ex":[{"id":"bench","unknown":true}]}}`, "bad json"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response, body := e.post(test.path, test.body, "cookie")
			if response.StatusCode != http.StatusBadRequest || !strings.Contains(errOf(body), test.errorField) {
				t.Fatalf("request = %d %v, want an error for %s", response.StatusCode, body, test.errorField)
			}
			raw, err := e.st.ReadState("u1")
			if err != nil || string(raw) != seed {
				t.Fatalf("rejected request changed state: %s, %v", raw, err)
			}
		})
	}
}

func TestProgramValidationSharedByRESTAndMCP(t *testing.T) {
	e := newTestEnv(t)
	invalid := training.MCPRoutineInput{Name: "Push", Ex: []training.MCPExConfig{{ID: "bench", Weight: new(-1.0)}}}
	if _, err := prepareTypedProgram([]training.MCPRoutineInput{invalid}, nil); err == nil || !strings.Contains(err.Error(), "weight") {
		t.Fatalf("MCP accepted invalid weight: %v", err)
	}
	valid := training.MCPRoutineInput{Name: " Push ", Ex: []training.MCPExConfig{{ID: " bench ", Weight: new(0.0), Inc: new(0.0), Bodyweight: new(false), Sg: new("superset")}}}
	prepared, err := prepareTypedProgram([]training.MCPRoutineInput{valid}, nil)
	if err != nil {
		t.Fatal(err)
	}
	response, body := e.post("/api/routine", `{"routine":{"name":" Push ","ex":[{"id":" bench ","weight":0,"inc":0,"bodyweight":false,"sg":"superset"}]}}`, "cookie")
	wantOK(t, response, body)
	routine := body["routine"].(map[string]any)
	entry := routine["ex"].([]any)[0].(map[string]any)
	if routine["id"] != prepared.routines[0].ID || entry["id"] != "bench" || entry["weight"] != float64(0) || entry["inc"] != float64(0) || entry["bodyweight"] != false || entry["sg"] != "superset" {
		t.Fatalf("normalized fields not preserved: %v", routine)
	}
	if *valid.Ex[0].Weight != 0 || valid.Ex[0].ID != " bench " {
		t.Fatal("normalization modified its input")
	}
}

func TestTypedActivityAndPushRequests(t *testing.T) {
	e := newTestEnv(t)
	for _, test := range []struct{ path, body string }{
		{"/api/activity", `{"active":"false"}`},
		{"/api/activity", `{"active":true,"setsDone":-1}`},
		{"/api/push/subscribe", `{"subscription":{"endpoint":"https://example.com"}}`},
		{"/api/push/rest-timer", `{"seconds":"45"}`},
		{"/api/push/rest-timer", `{"seconds":3601}`},
	} {
		response, body := e.post(test.path, test.body, "cookie")
		if response.StatusCode != http.StatusBadRequest || errOf(body) == "" {
			t.Fatalf("invalid request accepted: %s = %d %v", test.path, response.StatusCode, body)
		}
	}
	response, body := e.post("/api/push/subscribe", `{"subscription":{"endpoint":"https://example.com/push","expirationTime":null,"keys":{"p256dh":"key","auth":"secret"}}}`, "cookie")
	wantOK(t, response, body)
	response, body = e.post("/api/activity", `{"active":true,"name":"Push","exIdx":1,"exTotal":2,"setsDone":3,"setsTotal":6,"startedAt":9007199254740993}`, "cookie")
	wantOK(t, response, body)
	if info := e.srv.Presence.Live("u1"); info == nil || info.StartedAt.UnixMilli() != 9007199254740993 {
		t.Fatalf("activity timestamp lost precision: %v", info)
	}
}
