package httpapi

import (
	"bufio"
	"bytes"
	"encoding/json/v2"
	"io"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/google/jsonschema-go/jsonschema"

	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

// ---------- task 13: MCP endpoint over streamable HTTP ----------

// rpc performs one JSON-RPC round-trip against /mcp carrying sid, returning
// the decoded response envelope. Handles both application/json replies and
// the SSE frames the SDK emits by default.
func (e *testEnv) rpc(t *testing.T, method, path string, body any, headers map[string]string) (*http.Response, map[string]any) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, e.url+path, rd)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
	}
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)

	var payload []byte
	if strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		sc := bufio.NewScanner(bytes.NewReader(raw))
		sc.Buffer(make([]byte, 1024*1024), 4*1024*1024)
		for sc.Scan() {
			line := sc.Text()
			if after, ok := strings.CutPrefix(line, "data:"); ok {
				payload = []byte(strings.TrimSpace(after))
			}
		}
	} else {
		payload = raw
	}

	var m map[string]any
	if len(payload) > 0 {
		if err := json.Unmarshal(payload, &m); err != nil {
			// Auth middleware may return plain-text 401 bodies.
			if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
				return resp, map[string]any{"error": string(payload)}
			}
			t.Fatalf("non-JSON payload %q (%q): %v", payload, raw[:min(len(raw), 120)], err)
		}
	}
	return resp, m
}

func TestMCPContractToolsAndRoundTrip(t *testing.T) {
	e := newTestEnv(t)

	meta := map[string]any{
		"io.modelcontextprotocol/protocolVersion":    "2026-07-28",
		"io.modelcontextprotocol/clientInfo":         map[string]any{"name": "test-client", "version": "1"},
		"io.modelcontextprotocol/clientCapabilities": map[string]any{},
	}
	hdr := func(method, name string) map[string]string {
		h := map[string]string{
			"Authorization":        "Bearer " + e.bearer,
			"Origin":               testOrigin,
			"MCP-Protocol-Version": "2026-07-28",
			"Mcp-Method":           method,
		}
		if name != "" {
			h["Mcp-Name"] = name
		}
		return h
	}

	// Current MCP requests are standalone and include protocol metadata.
	_, listed := e.rpc(t, "POST", "/mcp", map[string]any{
		"jsonrpc": "2.0", "id": 2, "method": "tools/list",
		"params": map[string]any{"_meta": meta},
	}, hdr("tools/list", ""))
	listResult, _ := listed["result"].(map[string]any)
	if _, ok := listResult["ttlMs"]; !ok {
		t.Errorf("tools/list missing ttlMs cache hint: %v", listResult)
	}
	if _, ok := listResult["cacheScope"]; !ok {
		t.Errorf("tools/list missing cacheScope cache hint: %v", listResult)
	}
	tools, _ := listed["result"].(map[string]any)["tools"].([]any)
	names := map[string]bool{}
	toolByName := map[string]map[string]any{}
	orderedNames := make([]string, 0, len(tools))
	for _, tl := range tools {
		tool := tl.(map[string]any)
		name := tool["name"].(string)
		names[name] = true
		orderedNames = append(orderedNames, name)
		toolByName[name] = tool
		if _, ok := tool["outputSchema"].(map[string]any); !ok {
			t.Errorf("%s missing inferred outputSchema: %v", name, tool["outputSchema"])
		}
		input, ok := tool["inputSchema"].(map[string]any)
		if !ok || input["type"] != "object" {
			t.Errorf("%s inputSchema is not an object: %v", name, tool["inputSchema"])
		}
		if closed, ok := input["additionalProperties"].(bool); !ok || closed {
			t.Errorf("%s input schema is not explicitly closed: %v", name, input)
		}
	}
	wantOrder := append([]string(nil), orderedNames...)
	slices.Sort(wantOrder)
	if len(orderedNames) != len(wantOrder) {
		t.Errorf("tools/list order length = %d, want %d (%v)", len(orderedNames), len(wantOrder), orderedNames)
	} else {
		for i := range wantOrder {
			if orderedNames[i] != wantOrder[i] {
				t.Errorf("tools/list order = %v, want %v", orderedNames, wantOrder)
				break
			}
		}
	}
	for _, name := range []string{"search_exercises", "get_today", "get_training_digest", "get_routines", "preview_program", "get_bodyweight", "get_history", "get_workouts", "next_workout_suggestion", "get_strength_progress", "get_muscle_balance", "get_next_progression", "get_session_prescription"} {
		annotations, _ := toolByName[name]["annotations"].(map[string]any)
		if annotations["readOnlyHint"] != true {
			t.Errorf("%s annotations = %v, want readOnlyHint=true", name, annotations)
		}
	}
	for _, name := range []string{"set_program", "add_day_session", "remove_day_session", "log_bodyweight", "log_workout", "log_exercise_sets"} {
		annotations, _ := toolByName[name]["annotations"].(map[string]any)
		if annotations["readOnlyHint"] != false {
			t.Errorf("%s annotations = %v, want readOnlyHint=false", name, annotations)
		}
	}
	if toolByName["set_program"]["annotations"].(map[string]any)["destructiveHint"] != true {
		t.Errorf("set_program should advertise destructiveHint=true")
	}
	if toolByName["log_workout"]["annotations"].(map[string]any)["destructiveHint"] != true {
		t.Errorf("log_workout should advertise destructiveHint=true because ids can be replaced")
	}
	if toolByName["log_exercise_sets"]["annotations"].(map[string]any)["destructiveHint"] != true {
		t.Errorf("log_exercise_sets should advertise destructiveHint=true because same-day sessions are replaced")
	}
	if toolByName["next_workout_suggestion"]["annotations"].(map[string]any)["openWorldHint"] != true {
		t.Errorf("next_workout_suggestion should advertise openWorldHint=true")
	}
	setSchema := toolByName["set_program"]["inputSchema"].(map[string]any)
	setProperties := setSchema["properties"].(map[string]any)
	expectedRevision := setProperties["expectedRevision"].(map[string]any)
	if expectedRevision["description"] == "" {
		t.Errorf("set_program expectedRevision is missing its struct-derived description: %v", expectedRevision)
	}
	workoutSchema := toolByName["log_workout"]["inputSchema"].(map[string]any)
	workoutProperties := workoutSchema["properties"].(map[string]any)
	if workoutProperties["workout"].(map[string]any)["description"] == "" {
		t.Errorf("log_workout input is missing its struct-derived description: %v", workoutProperties["workout"])
	}
	inputTypes := map[string]reflect.Type{
		"search_exercises":         reflect.TypeFor[training.MCPSearchExercisesInput](),
		"get_today":                reflect.TypeFor[training.MCPDateInput](),
		"get_training_digest":      reflect.TypeFor[training.MCPDateInput](),
		"get_routines":             reflect.TypeFor[MCPEmptyInput](),
		"preview_program":          reflect.TypeFor[training.MCPPreviewProgramInput](),
		"set_program":              reflect.TypeFor[training.MCPSetProgramInput](),
		"add_day_session":          reflect.TypeFor[training.MCPAddDaySessionInput](),
		"remove_day_session":       reflect.TypeFor[training.MCPRemoveDaySessionInput](),
		"get_bodyweight":           reflect.TypeFor[training.MCPBodyweightFilterInput](),
		"log_bodyweight":           reflect.TypeFor[training.MCPLogBodyweightInput](),
		"get_history":              reflect.TypeFor[training.MCPHistoryInput](),
		"get_workouts":             reflect.TypeFor[training.MCPLimitInput](),
		"log_workout":              reflect.TypeFor[training.MCPLogWorkoutInput](),
		"log_exercise_sets":        reflect.TypeFor[training.MCPLogExerciseSetsInput](),
		"next_workout_suggestion":  reflect.TypeFor[training.MCPDateInput](),
		"get_strength_progress":    reflect.TypeFor[training.MCPStrengthProgressInput](),
		"get_muscle_balance":       reflect.TypeFor[training.MCPMuscleBalanceInput](),
		"get_next_progression":     reflect.TypeFor[training.MCPNextProgressionInput](),
		"get_session_prescription": reflect.TypeFor[training.MCPDateInput](),
	}
	for name, typ := range inputTypes {
		assertMCPInputSchemaMatchesStruct(t, name, toolByName[name]["inputSchema"].(map[string]any), typ)
	}
	for _, want := range []string{
		"search_exercises", "get_today", "get_training_digest",
		"get_routines", "set_program", "add_day_session", "remove_day_session",
		"preview_program",
		"get_bodyweight", "log_bodyweight",
		"get_history", "get_workouts", "log_workout", "log_exercise_sets",
		"next_workout_suggestion", "get_strength_progress", "get_muscle_balance", "get_next_progression",
		"get_session_prescription",
	} {
		if !names[want] {
			t.Errorf("tools/list missing %q (got %v)", want, names)
		}
	}
	for _, gone := range []string{
		"get_settings", "update_settings", "upsert_routine", "delete_routine",
		"get_week", "set_week", "get_day_plan", "set_day_plan",
		"delete_workout", "get_profile",
	} {
		if names[gone] {
			t.Errorf("tools/list still has pruned tool %q", gone)
		}
	}

	// search_exercises round-trip
	call := map[string]any{
		"jsonrpc": "2.0", "id": 3, "method": "tools/call",
		"params": map[string]any{
			"name":      "search_exercises",
			"arguments": map[string]any{"q": "bench press barbell", "limit": 5},
			"_meta":     meta,
		},
	}
	resp, called := e.rpc(t, "POST", "/mcp", call, hdr("tools/call", "search_exercises"))
	if resp.StatusCode != 200 {
		t.Fatalf("tools/call = %d %v", resp.StatusCode, called)
	}
	result, _ := called["result"].(map[string]any)
	if result["isError"] == true {
		t.Fatalf("tool errored: %v", result)
	}
	content, _ := result["content"].([]any)
	if len(content) == 0 {
		t.Fatalf("empty content: %v", result)
	}
	text, _ := content[0].(map[string]any)["text"].(string)
	if _, ok := result["structuredContent"]; !ok {
		t.Fatalf("structuredContent missing: %v", result)
	}
	var searchOut struct {
		Exercises []map[string]any `json:"exercises"`
	}
	if err := json.Unmarshal([]byte(text), &searchOut); err != nil {
		t.Fatalf("search payload: %v %q", err, text)
	}
	if len(searchOut.Exercises) == 0 {
		t.Fatalf("expected bench press hits, got none")
	}

	// Typed SDK validation rejects unknown fields as a recoverable tool error.
	_, invalid := e.rpc(t, "POST", "/mcp", map[string]any{
		"jsonrpc": "2.0", "id": 30, "method": "tools/call",
		"params": map[string]any{"name": "search_exercises", "arguments": map[string]any{"unexpected": true}, "_meta": meta},
	}, hdr("tools/call", "search_exercises"))
	invalidResult, _ := invalid["result"].(map[string]any)
	if invalidResult["isError"] != true {
		t.Fatalf("invalid input should be isError tool result: %v", invalid)
	}

	// log_bodyweight through MCP and confirm state change.
	var tsBefore float64
	if st := getStateRaw(t, e); st != nil {
		tsBefore, _ = st["_ts"].(float64)
	}
	call2 := map[string]any{
		"jsonrpc": "2.0", "id": 4, "method": "tools/call",
		"params": map[string]any{
			"name":      "log_bodyweight",
			"arguments": map[string]any{"w": 80.5, "d": "2026-08-26"},
			"_meta":     meta,
		},
	}
	resp, called = e.rpc(t, "POST", "/mcp", call2, hdr("tools/call", "log_bodyweight"))
	if resp.StatusCode != 200 {
		t.Fatalf("log_bodyweight = %d %v", resp.StatusCode, called)
	}
	state := getStateRaw(t, e)
	if state == nil {
		t.Fatal("nil state")
	}
	bw, _ := state["bodyweight"].([]any)
	if len(bw) == 0 {
		t.Fatalf("bodyweight not logged: %v", state["bodyweight"])
	}
	tsAfter, _ := state["_ts"].(float64)
	if tsAfter == 0 || tsAfter <= tsBefore {
		t.Fatalf("_ts not bumped: before=%v after=%v", tsBefore, tsAfter)
	}
}

func assertMCPInputSchemaMatchesStruct(t *testing.T, name string, actual map[string]any, typ reflect.Type) {
	t.Helper()
	inferred, err := jsonschema.ForType(typ, &jsonschema.ForOptions{})
	if err != nil {
		t.Fatalf("infer %s input schema: %v", name, err)
	}
	actualProperties, _ := actual["properties"].(map[string]any)
	actualNames := make([]string, 0, len(actualProperties))
	for property, rawProperty := range actualProperties {
		actualNames = append(actualNames, property)
		propertySchema, _ := rawProperty.(map[string]any)
		if propertySchema["description"] == "" {
			t.Errorf("%s.%s is missing an input description", name, property)
		}
	}
	inferredNames := make([]string, 0, len(inferred.Properties))
	for property := range inferred.Properties {
		inferredNames = append(inferredNames, property)
	}
	slices.Sort(actualNames)
	slices.Sort(inferredNames)
	if strings.Join(actualNames, ",") != strings.Join(inferredNames, ",") {
		t.Errorf("%s input properties drifted from %s: actual=%v inferred=%v", name, typ, actualNames, inferredNames)
	}
	actualRequiredRaw, _ := actual["required"].([]any)
	actualRequired := make([]string, 0, len(actualRequiredRaw))
	for _, value := range actualRequiredRaw {
		if property, ok := value.(string); ok {
			actualRequired = append(actualRequired, property)
		}
	}
	inferredRequired := append([]string(nil), inferred.Required...)
	slices.Sort(actualRequired)
	slices.Sort(inferredRequired)
	if strings.Join(actualRequired, ",") != strings.Join(inferredRequired, ",") {
		t.Errorf("%s required inputs drifted from %s: actual=%v inferred=%v", name, typ, actualRequired, inferredRequired)
	}
}

func TestMCPModernProtocolDiscoverIsStateless(t *testing.T) {
	e := newTestEnv(t)
	h := map[string]string{
		"Authorization":        "Bearer " + e.bearer,
		"Origin":               testOrigin,
		"MCP-Protocol-Version": "2026-07-28",
		"Mcp-Method":           "server/discover",
	}
	resp, discover := e.rpc(t, "POST", "/mcp", map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": "server/discover",
		"params": map[string]any{"_meta": map[string]any{
			"io.modelcontextprotocol/protocolVersion":    "2026-07-28",
			"io.modelcontextprotocol/clientInfo":         map[string]any{"name": "modern-client", "version": "1"},
			"io.modelcontextprotocol/clientCapabilities": map[string]any{},
		}},
	}, h)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("modern discover = %d %v", resp.StatusCode, discover)
	}
	discoverResult, ok := discover["result"].(map[string]any)
	if !ok {
		t.Fatalf("modern discover result = %v", discover)
	}
	versions, _ := discoverResult["supportedVersions"].([]any)
	foundLatest := false
	for _, version := range versions {
		if version == "2026-07-28" {
			foundLatest = true
		}
	}
	if !foundLatest {
		t.Fatalf("modern discover supportedVersions = %v", versions)
	}
	if discoverResult["instructions"] == nil || !strings.Contains(strings.ToLower(discoverResult["instructions"].(string)), "preview") {
		t.Fatalf("modern discover instructions = %v", discoverResult["instructions"])
	}
	if got := resp.Header.Get("Mcp-Session-Id"); got != "" {
		t.Fatalf("modern stateless response issued session id %q", got)
	}

	// The per-request protocol metadata and HTTP header must agree.
	badHeader := map[string]string{
		"Authorization":        "Bearer " + e.bearer,
		"Origin":               testOrigin,
		"MCP-Protocol-Version": "2025-11-25",
		"Mcp-Method":           "server/discover",
	}
	badResp, _ := e.rpc(t, "POST", "/mcp", map[string]any{
		"jsonrpc": "2.0", "id": 11, "method": "server/discover",
		"params": map[string]any{"_meta": map[string]any{
			"io.modelcontextprotocol/protocolVersion":    "2026-07-28",
			"io.modelcontextprotocol/clientInfo":         map[string]any{"name": "modern-client", "version": "1"},
			"io.modelcontextprotocol/clientCapabilities": map[string]any{},
		}},
	}, badHeader)
	if badResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("mismatched modern protocol header = %d, want 400", badResp.StatusCode)
	}

	// A modern call is standalone: it needs no initialize handshake or session
	// header and still returns the normal structured tool result.
	h["Mcp-Method"] = "tools/call"
	h["Mcp-Name"] = "get_bodyweight"
	resp, called := e.rpc(t, "POST", "/mcp", map[string]any{
		"jsonrpc": "2.0", "id": 2, "method": "tools/call",
		"params": map[string]any{"name": "get_bodyweight", "arguments": map[string]any{}, "_meta": map[string]any{
			"io.modelcontextprotocol/protocolVersion":    "2026-07-28",
			"io.modelcontextprotocol/clientInfo":         map[string]any{"name": "modern-client", "version": "1"},
			"io.modelcontextprotocol/clientCapabilities": map[string]any{},
		}},
	}, h)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("modern standalone call = %d %v", resp.StatusCode, called)
	}
	result, _ := called["result"].(map[string]any)
	if _, ok := result["structuredContent"]; !ok || result["isError"] == true {
		t.Fatalf("modern standalone result = %v", result)
	}
}

func TestMCPProgramPreviewGuardAndAnalytics(t *testing.T) {
	e := newTestEnv(t)
	headers := map[string]string{"Authorization": "Bearer " + e.bearer, "Origin": testOrigin}
	program := map[string]any{"routines": []any{map[string]any{"name": "MCP Preview", "ex": []any{}}}}
	call := func(t *testing.T, id int, name string, args map[string]any) map[string]any {
		t.Helper()
		_, response := e.rpc(t, "POST", "/mcp", map[string]any{"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": map[string]any{"name": name, "arguments": args}}, headers)
		result, ok := response["result"].(map[string]any)
		if !ok {
			t.Fatalf("%s response = %v", name, response)
		}
		return result
	}

	// The fixture starts as a document without a revision. Establish a
	// first guarded-write revision, then preview and race the next write.
	call(t, 0, "set_program", program)
	preview := call(t, 1, "preview_program", program)
	if preview["isError"] == true {
		t.Fatalf("preview errored: %v", preview)
	}
	structured, ok := preview["structuredContent"].(map[string]any)
	if !ok {
		t.Fatalf("preview missing structuredContent: %v", preview)
	}
	revision, ok := structured["currentRevision"].(float64)
	if !ok {
		t.Fatalf("preview currentRevision = %v", structured["currentRevision"])
	}
	call(t, 2, "set_program", program)
	stale := call(t, 3, "set_program", map[string]any{"routines": program["routines"], "expectedRevision": revision})
	if stale["isError"] != true {
		t.Fatalf("stale set_program should be recoverable isError: %v", stale)
	}

	strength := call(t, 4, "get_strength_progress", map[string]any{"exerciseId": "barbell-bench-press"})
	if strength["isError"] == true || strength["structuredContent"] == nil {
		t.Fatalf("strength structured result = %v", strength)
	}
	balance := call(t, 5, "get_muscle_balance", map[string]any{"days": 30})
	if balance["isError"] == true || balance["structuredContent"] == nil {
		t.Fatalf("muscle balance structured result = %v", balance)
	}
}

// getStateRaw fetches u1's full state blob via bearer-authenticated
// GET /api/data.
func getStateRaw(t *testing.T, e *testEnv) map[string]any {
	t.Helper()
	req, _ := http.NewRequest("GET", e.url+"/api/data", nil)
	req.Header.Set("Authorization", "Bearer "+e.bearer)
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)
	var m struct {
		State map[string]any `json:"state"`
	}
	_ = json.Unmarshal(raw, &m)
	return m.State
}

func TestMCPCookiesRejected(t *testing.T) {
	e := newTestEnv(t)

	// A valid session cookie is NOT an MCP credential.
	req, _ := http.NewRequest("POST", e.url+"/mcp", strings.NewReader(
		`{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"test-client","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}`))
	req.Header.Set("Cookie", "gymsid="+e.cookieVal("u1"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("MCP-Protocol-Version", "2026-07-28")
	req.Header.Set("Mcp-Method", "server/discover")
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 401 {
		t.Fatalf("cookie discover = %d %s", resp.StatusCode, raw)
	}
	wa := resp.Header.Get("WWW-Authenticate")
	if !strings.Contains(wa, "resource_metadata=") {
		t.Fatalf("missing WWW-Authenticate resource_metadata: %q", wa)
	}

	// Neither is no credential at all.
	resp2, _ := e.rpc(t, "POST", "/mcp",
		map[string]any{"jsonrpc": "2.0", "id": 1, "method": "ping"},
		map[string]string{})
	if resp2.StatusCode != 401 {
		t.Fatalf("anonymous = %d", resp2.StatusCode)
	}

	// And a garbage bearer token fails verification.
	resp3, _ := e.rpc(t, "POST", "/mcp",
		map[string]any{"jsonrpc": "2.0", "id": 1, "method": "ping"},
		map[string]string{"Authorization": "Bearer not-a-token"})
	if resp3.StatusCode != 401 {
		t.Fatalf("bad token = %d", resp3.StatusCode)
	}
}

func TestOAuthMetadata(t *testing.T) {
	e := newTestEnv(t)
	resp, err := e.client.Get(e.url + "/.well-known/oauth-protected-resource")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 200 {
		t.Fatalf("PRM status %d", resp.StatusCode)
	}
	var prm map[string]any
	if err := json.UnmarshalRead(resp.Body, &prm); err != nil {
		t.Fatal(err)
	}
	if prm["resource"] != testOrigin+"/mcp" {
		t.Fatalf("resource = %v", prm["resource"])
	}

	resp2, err := e.client.Get(e.url + "/.well-known/oauth-authorization-server")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp2.Body.Close() }()
	var as map[string]any
	if err := json.UnmarshalRead(resp2.Body, &as); err != nil {
		t.Fatal(err)
	}
	if as["authorization_endpoint"] != testOrigin+"/oauth/authorize" {
		t.Fatalf("authorize = %v", as["authorization_endpoint"])
	}
	if as["registration_endpoint"] != testOrigin+"/oauth/register" {
		t.Fatalf("register = %v", as["registration_endpoint"])
	}
}
