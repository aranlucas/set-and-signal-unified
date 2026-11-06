package httpapi

import (
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/http"

	"github.com/aranlucas/set-and-signal-unified/internal/ai"
	"github.com/aranlucas/set-and-signal-unified/internal/validation"

	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

// AI workout planning (server.js lines 664–705). GET status is public;
// next-workout accepts any credential, like upstream's auth() guard.

const systemPrompt = "You are a strength coach planning the athlete's NEXT workout from their logs. " +
	"Rules: progress conservatively — no weight jumps above ~10%; if recent sets show missed reps or big drops, reduce; " +
	"bodyweight exercises progress in reps or extra sets, not load; timed exercises change seconds, cardio changes minutes/speed. " +
	"Keep the same exercises unless a swap is clearly better (then set swapTo to another exercise id). " +
	"Return the structured workout plan requested by the response schema. Use null for adjustment fields that should stay unchanged. " +
	"Every entry.id MUST be an exercise id from one of the digest's sessions; include one entry per exercise you want to adjust."

// GET /api/ai/status — no auth upstream; the login screen probes it.
func (s *Server) aiStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, aiStatusResponse{Enabled: s.aiEnabled(), Model: s.Cfg.OpenRouterModel})
}

type aiStatusResponse struct {
	Enabled bool   `json:"enabled"`
	Model   string `json:"model"`
}

type aiNextWorkoutRequest struct {
	Digest jsontext.Value `json:"digest"`
}

type aiNextWorkoutResponse struct {
	Suggestion training.MCPSuggestionOutput `json:"suggestion"`
	Model      string                       `json:"model"`
}

func (s *Server) aiEnabled() bool {
	return s.AI != nil && s.AI.APIKey != ""
}

// POST /api/ai/next-workout — turns the client-built training-log digest into
// a suggestion for today's session.
func (s *Server) postAINextWorkout(w http.ResponseWriter, r *http.Request) {
	u := s.requireAnyAuth(w, r)
	if u == nil {
		return
	}
	var body aiNextWorkoutRequest
	if !readJSON(w, r, &body) {
		return
	}
	parsed, code, errMsg := s.nextWorkoutSuggestion(r.Context(), body.Digest)
	if code != 0 {
		writeErr(w, code, errMsg)
		return
	}
	writeJSON(w, http.StatusOK, aiNextWorkoutResponse{Suggestion: parsed, Model: s.Cfg.OpenRouterModel})
}

// nextWorkoutSuggestion is the pipeline shared by the HTTP route and the MCP
// tool: digest size cap → provider chat → JSON extraction → validation. A zero code means success and parsed holds
// {summary, entries}; otherwise code/msg carry the HTTP-mapped failure so
// both surfaces answer identically.
func (s *Server) nextWorkoutSuggestion(ctx context.Context, digest jsontext.Value) (training.MCPSuggestionOutput, int, string) {
	return s.nextWorkoutSuggestionJSON(ctx, compactDigestJSON(digest))
}

// nextWorkoutSuggestionMCP is the typed MCP entry point. The MCP handler
// passes the closed MCPTrainingDigest graph directly, and receives the
// closed MCPSuggestionOutput graph directly; no generic output decoder or
// JSON round-trip sits between the AI response and the MCP contract.
func (s *Server) nextWorkoutSuggestionMCP(ctx context.Context, digest training.MCPTrainingDigest) (training.MCPSuggestionOutput, int, string) {
	return s.nextWorkoutSuggestionJSON(ctx, marshalTrainingDigest(digest))
}

// nextWorkoutSuggestionJSON decodes and validates the provider response into the shared DTO.
func (s *Server) nextWorkoutSuggestionJSON(ctx context.Context, raw []byte) (training.MCPSuggestionOutput, int, string) {
	const unavailable = "AI planning is not configured on this instance (set OPENROUTER_API_KEY)"
	if !s.aiEnabled() {
		return training.MCPSuggestionOutput{}, http.StatusServiceUnavailable, unavailable
	}

	// The digest is built client-side from the caller's own logs; cap it so a
	// runaway client can't turn into a runaway token bill.
	if len(raw) > 120000 {
		return training.MCPSuggestionOutput{}, http.StatusRequestEntityTooLarge, "digest too large"
	}

	text, err := s.AI.Chat(ctx, []ai.Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: "Training log digest (JSON):\n" + string(raw)},
	})
	if err != nil {
		return training.MCPSuggestionOutput{}, http.StatusBadGateway, "AI provider error: " + err.Error()
	}

	var plan training.MCPSuggestionOutput
	if err := json.Unmarshal([]byte(text), &plan, json.RejectUnknownMembers(true)); err != nil {
		return training.MCPSuggestionOutput{}, http.StatusBadGateway, "AI reply was not valid JSON — try again"
	}
	if err := validation.Validator.Struct(plan); err != nil {
		return training.MCPSuggestionOutput{}, http.StatusBadGateway, "AI reply failed validation — try again"
	}
	if plan.Summary == "" && len(plan.Entries) == 0 {
		return training.MCPSuggestionOutput{}, http.StatusBadGateway, "AI reply was empty — try again"
	}
	if plan.Entries == nil {
		plan.Entries = []training.MCPSuggestionEntry{}
	}
	for i := range plan.Entries {
		entry := &plan.Entries[i]
		for _, field := range []**float64{&entry.Sets, &entry.Reps, &entry.Weight, &entry.Sec, &entry.Min, &entry.Speed} {
			if *field != nil {
				*field = new(roundHundredths(**field))
			}
		}
	}
	return plan, 0, ""
}

// marshalTrainingDigest is JSON.stringify for the typed MCP digest. JSON v2
// emits compact output without HTML escaping or a trailing newline by default.
func marshalTrainingDigest(digest training.MCPTrainingDigest) []byte {
	out, err := json.Marshal(digest)
	if err != nil {
		return nil
	}
	return out
}

// compactDigestJSON preserves the HTTP route's open digest input while
// keeping its output typed. A missing or null digest has the historic empty
// object meaning; valid JSON is compacted before enforcing the size cap.
func compactDigestJSON(digest jsontext.Value) []byte {
	digest = jsontext.Value(bytes.TrimSpace(digest))
	if len(digest) == 0 || bytes.Equal(digest, []byte("null")) {
		return []byte("{}")
	}
	compact := digest.Clone()
	if err := compact.Compact(); err != nil {
		return nil
	}
	return compact
}
