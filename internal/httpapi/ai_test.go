package httpapi

import (
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aranlucas/set-and-signal-unified/internal/ai"
)

func TestNextWorkoutSuggestionMCPUsesClosedOutput(t *testing.T) {
	provider := httptest.NewTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		body, _ := json.Marshal(map[string]any{
			"id":         "resp_test",
			"object":     "response",
			"created_at": 1,
			"status":     "completed",
			"model":      "test/model",
			"output": []map[string]any{{
				"id":     "msg_test",
				"type":   "message",
				"status": "completed",
				"role":   "assistant",
				"content": []map[string]any{{
					"type":        "output_text",
					"text":        "{\"summary\":\"Keep the effort steady.\",\"entries\":[{\"id\":\"squat\",\"sets\":3,\"weight\":100,\"swapTo\":\"bench\",\"note\":\"Add one rep\"}]}",
					"annotations": []any{},
				}},
			}},
		})
		_, _ = w.Write(body)
	}))
	client := provider.Client()

	s := &Server{AI: &ai.Client{APIKey: "test-key", Model: "test-model", BaseURL: provider.URL, HTTP: client}}
	digest := MCPTrainingDigest{
		Unit:  "kg",
		Today: "2026-08-28",
		Sessions: []MCPTrainingDigestSession{{
			RoutineID: "strength",
			Name:      "Strength",
			Entries:   []MCPDigestExerciseEntry{{ID: "squat", Name: "Back squat", Sets: new(3.0), Reps: new(5.0)}},
		}},
		Bodyweight:   []MCPBodyweightEntry{{D: "2026-08-27", W: 80}},
		LastWorkouts: []MCPDigestWorkout{},
	}

	got, code, msg := s.nextWorkoutSuggestionMCP(t.Context(), digest)
	if code != 0 || msg != "" {
		t.Fatalf("typed suggestion failed: code=%d msg=%q", code, msg)
	}
	if got.Summary != "Keep the effort steady." || len(got.Entries) != 1 {
		t.Fatalf("typed suggestion = %#v", got)
	}
	entry := got.Entries[0]
	if entry.ID != "squat" || entry.Sets == nil || *entry.Sets != 3 || entry.Weight == nil || *entry.Weight != 100 {
		t.Fatalf("typed entry = %#v", entry)
	}
	if entry.SwapTo == nil || *entry.SwapTo != "bench" || entry.Note == nil || *entry.Note != "Add one rep" {
		t.Fatalf("typed entry annotations = %#v", entry)
	}
}
