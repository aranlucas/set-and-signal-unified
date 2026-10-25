package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"runtime/debug"
	"slices"
	"strings"
	"time"

	mcpauth "github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/aranlucas/set-and-signal-unified/internal/exercises"
	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

type mcpCallerKey struct{}

func mcpVersion() string {
	if bi, ok := debug.ReadBuildInfo(); ok {
		switch bi.Main.Version {
		case "", "(devel)":
		default:
			return bi.Main.Version
		}
	}
	return "dev"
}

func (s *Server) verifyMCPToken(_ context.Context, secret string, _ *http.Request) (*mcpauth.TokenInfo, error) {
	if s.OAuth == nil {
		return nil, mcpauth.ErrInvalidToken
	}
	return s.OAuth.VerifyBearer(secret)
}

type MCPEmptyInput struct{}

func mcpReadAnnotations() mcp.ToolAnnotations {
	return mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true, DestructiveHint: new(false), OpenWorldHint: new(false)}
}

func mcpWriteAnnotations(destructive, idempotent bool) mcp.ToolAnnotations {
	return mcp.ToolAnnotations{ReadOnlyHint: false, IdempotentHint: idempotent, DestructiveHint: new(destructive), OpenWorldHint: new(false)}
}

func mcpUID(ctx context.Context) string {
	if ti := mcpauth.TokenInfoFromContext(ctx); ti != nil {
		return ti.UserID
	}
	uid, _ := ctx.Value(mcpCallerKey{}).(string)
	return uid
}

func (s *Server) searchExercisesTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPSearchExercisesInput) (*mcp.CallToolResult, MCPSearchExercisesOutput, error) {
	view, err := s.loadTrainingData(mcpUID(ctx))
	if err != nil {
		return nil, MCPSearchExercisesOutput{}, errors.New("server error")
	}
	limit := 25
	if input.Limit != nil {
		if *input.Limit < 1 || *input.Limit > 100 {
			return nil, MCPSearchExercisesOutput{}, errors.New("limit must be between 1 and 100")
		}
		limit = *input.Limit
	}
	rows := searchExercises(view, input.Q, exercises.SearchFilters{BodyPart: input.BP, Equipment: input.EQ, Limit: limit})
	return nil, MCPSearchExercisesOutput{Exercises: rows}, nil
}

func (s *Server) getTodayTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPDateInput) (*mcp.CallToolResult, MCPTodayResult, error) {
	view, err := s.loadTrainingData(mcpUID(ctx))
	if err != nil {
		return nil, MCPTodayResult{}, errors.New("server error")
	}
	iso := ""
	if input.Iso != nil {
		iso = *input.Iso
	}
	if iso != "" && !training.ValidISODate(iso) {
		return nil, MCPTodayResult{}, errors.New("date must be YYYY-MM-DD")
	}
	if input.Tz != nil && strings.TrimSpace(*input.Tz) == "" {
		return nil, MCPTodayResult{}, errors.New("timezone must not be empty")
	}
	if iso == "" {
		tz := ""
		if input.Tz != nil {
			tz = *input.Tz
		}
		iso = todayISOLocal(tz, time.Now())
	}
	return nil, trainingDay(view, iso), nil
}

func (s *Server) getTrainingDigestTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPDateInput) (*mcp.CallToolResult, MCPTrainingDigest, error) {
	out, err := s.mcpTrainingDigestFor(mcpUID(ctx), input)
	return nil, out, err
}

func (s *Server) getRoutinesTool(ctx context.Context, _ *mcp.CallToolRequest, _ MCPEmptyInput) (*mcp.CallToolResult, MCPRoutinesOutput, error) {
	view, err := s.loadTrainingData(mcpUID(ctx))
	if err != nil {
		return nil, MCPRoutinesOutput{}, errors.New("server error")
	}
	return nil, MCPRoutinesOutput{Routines: view.Routines}, nil
}

func (s *Server) previewProgramTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPPreviewProgramInput) (*mcp.CallToolResult, MCPProgramPreview, error) {
	prepared, err := prepareTypedProgram(input.Routines, input.Week)
	if err != nil {
		return nil, MCPProgramPreview{}, err
	}
	view, err := s.loadTrainingData(mcpUID(ctx))
	if err != nil {
		return nil, MCPProgramPreview{}, errors.New("server error")
	}

	applied := typedApplyProgram(view.Routines, view.Week, prepared, input.Replace)
	before := MCPProgramState{Routines: slices.Clone(view.Routines), Week: cloneMCPWeek(view.Week)}
	result := MCPProgramState{Routines: applied.routines, Week: applied.week}
	revision := new(view.Revision)
	return nil, MCPProgramPreview{
		OK:              true,
		Replace:         new(input.Replace),
		Sanitized:       MCPProgramInput{Routines: routinesToInput(prepared.routines), Week: cloneMCPWeek(prepared.week), Replace: input.Replace},
		Proposed:        result,
		Result:          result,
		Diff:            typedProgramDiff(before, result),
		Revision:        revision,
		CurrentRevision: revision,
	}, nil
}

func (s *Server) setProgramTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPSetProgramInput) (*mcp.CallToolResult, MCPSetProgramOutput, error) {
	prepared, err := prepareTypedProgram(input.Routines, input.Week)
	if err != nil {
		return nil, MCPSetProgramOutput{}, err
	}
	uid := mcpUID(ctx)
	if err := s.mutateTypedProgram(uid, prepared, input.Replace, input.ExpectedRevision); err != nil {
		return nil, MCPSetProgramOutput{}, err
	}
	data, err := NewTrainingDataRepository(s.ST).Load(uid)
	if err != nil {
		return nil, MCPSetProgramOutput{}, errors.New("server error")
	}
	return nil, MCPSetProgramOutput{
		OK: true, Routines: cloneMCPRoutines(data.Routines), Week: cloneMCPWeek(data.Week), Revision: data.Revision,
	}, nil
}

func (s *Server) getBodyweightTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPBodyweightFilterInput) (*mcp.CallToolResult, MCPBodyweightOutput, error) {
	view, err := s.loadTrainingData(mcpUID(ctx))
	if err != nil {
		return nil, MCPBodyweightOutput{}, errors.New("server error")
	}
	filter := ""
	if input.D != nil {
		filter = *input.D
	}
	if filter != "" && !training.ValidISODate(filter) {
		return nil, MCPBodyweightOutput{}, errors.New("date must be YYYY-MM-DD")
	}
	entries := make([]MCPBodyweightEntry, 0, len(view.Bodyweight))
	for _, entry := range view.Bodyweight {
		if filter == "" || entry.D == filter {
			entries = append(entries, entry)
		}
	}
	unit := view.Unit
	if unit == "" {
		unit = "kg"
	}
	return nil, MCPBodyweightOutput{Unit: unit, Goal: view.TargetW, Bodyweight: entries}, nil
}

func (s *Server) logBodyweightTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPLogBodyweightInput) (*mcp.CallToolResult, MCPLogBodyweightOutput, error) {
	date := ""
	if input.D != nil {
		date = *input.D
	}
	if input.Tz != nil && strings.TrimSpace(*input.Tz) == "" {
		return nil, MCPLogBodyweightOutput{}, errors.New("timezone must not be empty")
	}
	if date == "" {
		tz := ""
		if input.Tz != nil {
			tz = *input.Tz
		}
		date = todayISOLocal(tz, time.Now())
	}
	data, err := NewTrainingDataRepository(s.ST).PutBodyweight(mcpUID(ctx), date, input.W)
	if err != nil {
		return nil, MCPLogBodyweightOutput{}, err
	}
	return nil, MCPLogBodyweightOutput{Unit: data.Unit, Goal: data.TargetW, OK: true, Date: date}, nil
}

func (s *Server) getHistoryTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPHistoryInput) (*mcp.CallToolResult, MCPHistoryOutput, error) {
	view, err := s.loadTrainingData(mcpUID(ctx))
	if err != nil {
		return nil, MCPHistoryOutput{}, errors.New("server error")
	}
	limit := 20
	if input.Limit != nil {
		if *input.Limit < 1 || *input.Limit > 100 {
			return nil, MCPHistoryOutput{}, errors.New("limit must be between 1 and 100")
		}
		limit = *input.Limit
	}
	query := historyQuery{Limit: limit}
	if input.Since != nil {
		query.Since = *input.Since
		if !training.ValidISODate(query.Since) {
			return nil, MCPHistoryOutput{}, errors.New("since must be YYYY-MM-DD")
		}
	}
	if input.Until != nil {
		query.Until = *input.Until
		if !training.ValidISODate(query.Until) {
			return nil, MCPHistoryOutput{}, errors.New("until must be YYYY-MM-DD")
		}
	}
	if input.ExerciseID != nil {
		query.ExerciseID = strings.TrimSpace(*input.ExerciseID)
		if query.ExerciseID == "" {
			return nil, MCPHistoryOutput{}, errors.New("exerciseId must not be empty")
		}
	}
	return nil, MCPHistoryOutput{History: buildHistory(view, query)}, nil
}

func (s *Server) getWorkoutsTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPLimitInput) (*mcp.CallToolResult, MCPWorkoutsOutput, error) {
	view, err := s.loadTrainingData(mcpUID(ctx))
	if err != nil {
		return nil, MCPWorkoutsOutput{}, errors.New("server error")
	}
	limit := 20
	if input.Limit != nil {
		if *input.Limit < 1 || *input.Limit > 100 {
			return nil, MCPWorkoutsOutput{}, errors.New("limit must be between 1 and 100")
		}
		limit = *input.Limit
	}
	workouts := slices.Clone(view.Workouts)
	slices.Reverse(workouts)
	if len(workouts) > limit {
		workouts = workouts[:limit]
	}
	return nil, MCPWorkoutsOutput{Workouts: workouts}, nil
}

func (s *Server) logWorkoutTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPLogWorkoutInput) (*mcp.CallToolResult, MCPWorkoutOutput, error) {
	workout, err := NewTrainingDataRepository(s.ST).PutWorkout(mcpUID(ctx), input.Workout)
	if err != nil {
		return nil, MCPWorkoutOutput{}, err
	}
	return nil, MCPWorkoutOutput{OK: true, Workout: workout}, nil
}

func (s *Server) nextWorkoutSuggestionTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPDateInput) (*mcp.CallToolResult, MCPSuggestionOutput, error) {
	digest, err := s.mcpTrainingDigestFor(mcpUID(ctx), input)
	if err != nil {
		return nil, MCPSuggestionOutput{}, err
	}
	suggestion, code, msg := s.nextWorkoutSuggestionMCP(ctx, digest)
	if code != 0 {
		return nil, MCPSuggestionOutput{}, errors.New(msg)
	}
	return nil, suggestion, nil
}

func (s *Server) getStrengthProgressTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPStrengthProgressInput) (*mcp.CallToolResult, MCPStrengthProgress, error) {
	view, err := s.loadTrainingData(mcpUID(ctx))
	if err != nil {
		return nil, MCPStrengthProgress{}, errors.New("server error")
	}
	formula := ""
	if input.Formula != nil {
		formula = *input.Formula
	}
	if formula == "" {
		formula = "epley"
	}
	if formula != "epley" && formula != "brzycki" && formula != "lombardi" {
		return nil, MCPStrengthProgress{}, errors.New("formula must be epley, brzycki, or lombardi")
	}
	input.ExerciseID = strings.TrimSpace(input.ExerciseID)
	if input.ExerciseID == "" {
		return nil, MCPStrengthProgress{}, errors.New("exerciseId must not be empty")
	}
	return nil, StrengthProgress(view, input.ExerciseID, formula), nil
}

func (s *Server) getMuscleBalanceTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPMuscleBalanceInput) (*mcp.CallToolResult, MCPMuscleBalance, error) {
	view, err := s.loadTrainingData(mcpUID(ctx))
	if err != nil {
		return nil, MCPMuscleBalance{}, errors.New("server error")
	}
	days := 30
	if input.Days != nil {
		days = *input.Days
	}
	if days != 0 && days != 7 && days != 30 && days != 90 {
		return nil, MCPMuscleBalance{}, errors.New("days must be 0, 7, 30, or 90")
	}
	asOf := ""
	if input.AsOf != nil {
		asOf = *input.AsOf
	}
	if asOf == "" {
		asOf = todayISOLocal("", time.Now())
	} else if !training.ValidISODate(asOf) {
		return nil, MCPMuscleBalance{}, errors.New("asOf must be YYYY-MM-DD")
	}
	return nil, MuscleBalance(view, asOf, days), nil
}

func (s *Server) getNextProgressionTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPNextProgressionInput) (*mcp.CallToolResult, MCPProgression, error) {
	input.ExerciseID = strings.TrimSpace(input.ExerciseID)
	if input.ExerciseID == "" {
		return nil, MCPProgression{}, errors.New("exerciseId must not be empty")
	}
	if input.RoutineID != nil {
		trimmed := strings.TrimSpace(*input.RoutineID)
		if trimmed == "" {
			return nil, MCPProgression{}, errors.New("routineId must not be empty")
		}
		input.RoutineID = new(trimmed)
	}
	view, err := s.loadTrainingData(mcpUID(ctx))
	if err != nil {
		return nil, MCPProgression{}, errors.New("server error")
	}
	var selected MCPRoutine
	var config MCPExConfig
	if input.RoutineID != nil {
		selected, err = view.FindRoutine(*input.RoutineID)
		if err != nil {
			return nil, MCPProgression{}, err
		}
		found := false
		for _, candidate := range selected.Ex {
			if candidate.ID == input.ExerciseID {
				config, found = candidate, true
				break
			}
		}
		if !found {
			return nil, MCPProgression{}, fmt.Errorf("exercise %q not found in routine %q", input.ExerciseID, selected.ID)
		}
	} else {
		ref, lookupErr := view.FindExerciseConfig(input.ExerciseID)
		if lookupErr != nil {
			return nil, MCPProgression{}, lookupErr
		}
		selected, err = view.FindRoutine(ref.RoutineID)
		if err != nil {
			return nil, MCPProgression{}, err
		}
		config = ref.Config
	}
	return nil, NextProgression(view, config, selected), nil
}

func (s *Server) getSessionPrescriptionTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPDateInput) (*mcp.CallToolResult, MCPDayPrescription, error) {
	view, err := s.loadTrainingData(mcpUID(ctx))
	if err != nil {
		return nil, MCPDayPrescription{}, errors.New("server error")
	}
	iso := ""
	if input.Iso != nil {
		iso = *input.Iso
	}
	if iso != "" && !training.ValidISODate(iso) {
		return nil, MCPDayPrescription{}, errors.New("date must be YYYY-MM-DD")
	}
	if input.Tz != nil && strings.TrimSpace(*input.Tz) == "" {
		return nil, MCPDayPrescription{}, errors.New("timezone must not be empty")
	}
	if iso == "" {
		tz := ""
		if input.Tz != nil {
			tz = *input.Tz
		}
		iso = todayISOLocal(tz, time.Now())
	}
	return nil, sessionPrescription(view, iso), nil
}

func (s *Server) addDaySessionTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPAddDaySessionInput) (*mcp.CallToolResult, MCPDaySessionsOutput, error) {
	iso := strings.TrimSpace(input.Iso)
	if !training.ValidISODate(iso) {
		return nil, MCPDaySessionsOutput{}, errors.New("date must be YYYY-MM-DD")
	}
	repo := NewTrainingDataRepository(s.ST)
	if err := repo.Mutate(mcpUID(ctx), input.ExpectedRevision, func(data *TrainingData) error {
		return training.AddSessionToDayPlan(data, iso, MCPDaySession{
			RoutineID: input.RoutineID, Start: input.Start, Label: input.Label,
		})
	}); err != nil {
		return nil, MCPDaySessionsOutput{}, err
	}
	data, err := repo.Load(mcpUID(ctx))
	if err != nil {
		return nil, MCPDaySessionsOutput{}, errors.New("server error")
	}
	sessions, _, rest := training.ResolveDaySessions(data, iso)
	return nil, MCPDaySessionsOutput{OK: true, Iso: iso, Rest: rest, Sessions: sessions, Revision: data.Revision}, nil
}

func (s *Server) removeDaySessionTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPRemoveDaySessionInput) (*mcp.CallToolResult, MCPDaySessionsOutput, error) {
	iso := strings.TrimSpace(input.Iso)
	if !training.ValidISODate(iso) {
		return nil, MCPDaySessionsOutput{}, errors.New("date must be YYYY-MM-DD")
	}
	repo := NewTrainingDataRepository(s.ST)
	if err := repo.Mutate(mcpUID(ctx), input.ExpectedRevision, func(data *TrainingData) error {
		return training.RemoveSessionFromDayPlan(data, iso, input.RoutineID, input.Index)
	}); err != nil {
		return nil, MCPDaySessionsOutput{}, err
	}
	data, err := repo.Load(mcpUID(ctx))
	if err != nil {
		return nil, MCPDaySessionsOutput{}, errors.New("server error")
	}
	sessions, _, rest := training.ResolveDaySessions(data, iso)
	return nil, MCPDaySessionsOutput{OK: true, Iso: iso, Rest: rest, Sessions: sessions, Revision: data.Revision}, nil
}

func (s *Server) logExerciseSetsTool(ctx context.Context, _ *mcp.CallToolRequest, input MCPLogExerciseSetsInput) (*mcp.CallToolResult, MCPLogExerciseSetsOutput, error) {
	repo := NewTrainingDataRepository(s.ST)
	var workout MCPWorkout
	var next MCPProgression
	if err := repo.Mutate(mcpUID(ctx), nil, func(data *TrainingData) error {
		var err error
		workout, next, err = logExerciseSets(data, input, time.Now())
		return err
	}); err != nil {
		return nil, MCPLogExerciseSetsOutput{}, err
	}
	data, err := repo.Load(mcpUID(ctx))
	if err != nil {
		return nil, MCPLogExerciseSetsOutput{}, errors.New("server error")
	}
	return nil, MCPLogExerciseSetsOutput{OK: true, Workout: workout, Next: next, Revision: data.Revision}, nil
}

func (s *Server) mcpTrainingDigestFor(uid string, input MCPDateInput) (MCPTrainingDigest, error) {
	view, err := s.loadTrainingData(uid)
	if err != nil {
		return MCPTrainingDigest{}, errors.New("server error")
	}
	iso := ""
	if input.Iso != nil {
		iso = *input.Iso
	}
	if iso != "" && !training.ValidISODate(iso) {
		return MCPTrainingDigest{}, errors.New("date must be YYYY-MM-DD")
	}
	if input.Tz != nil && strings.TrimSpace(*input.Tz) == "" {
		return MCPTrainingDigest{}, errors.New("timezone must not be empty")
	}
	if iso == "" {
		tz := ""
		if input.Tz != nil {
			tz = *input.Tz
		}
		iso = todayISOLocal(tz, time.Now())
	}
	today := trainingDay(view, iso)
	if today.Rest || len(today.Sessions) == 0 {
		return MCPTrainingDigest{}, errors.New("rest day — nothing scheduled")
	}
	sessions := make([]MCPDaySession, 0, len(today.Sessions))
	for _, session := range today.Sessions {
		sessions = append(sessions, MCPDaySession{
			RoutineID: session.RoutineID, Start: session.Start, Label: session.Label,
		})
	}
	return buildTrainingDigest(view, sessions, iso), nil
}

func (s *Server) buildMCPServer() *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{Name: "Set & Signal", Version: mcpVersion()}, &mcp.ServerOptions{Instructions: "Set & Signal manages the authenticated user's training state. Preview changes before replacing programs; use expectedRevision when applying changes. Weekdays map to ordered session lists — use add_day_session / remove_day_session to pin one session onto a date without replacing the week."})
	read := mcpReadAnnotations()
	write := mcpWriteAnnotations(true, false)
	bwWrite := mcpWriteAnnotations(true, true)
	workoutWrite := mcpWriteAnnotations(true, true)
	openWorldRead := mcpReadAnnotations()
	openWorldRead.OpenWorldHint = new(true)
	mcp.AddTool(srv, &mcp.Tool{Name: "search_exercises", Description: "Search the exercise catalog and custom exercises by name, muscle, or equipment. Use returned ids in set_program.", Annotations: &read}, s.searchExercisesTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "get_today", Description: "Resolve today's or a supplied ISO date to ordered sessions (each with its own routine), override, weekday slots, or rest day. Planned weights are filled from history so a logged lift is not prescribed at 0.", Annotations: &read}, s.getTodayTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "get_training_digest", Description: "Build the compact training-log digest used for coaching. Returns every session for the day with its own exercise list; entries include the next working weight when history exists.", Annotations: &read}, s.getTrainingDigestTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "get_routines", Description: "List the caller's routines with their exercise entries.", Annotations: &read}, s.getRoutinesTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "preview_program", Description: "Validate and preview a program change; pass its revision as expectedRevision to set_program.", Annotations: &read}, s.previewProgramTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "set_program", Description: "Create or update a full training program. Week values are ordered session lists per weekday. Preview first and pass its revision as expectedRevision for a guarded apply.", Annotations: &write}, s.setProgramTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "add_day_session", Description: "Append one routine as a session on a specific ISO date via day override, without replacing the weekly template. Use this to pin an extra workout onto an existing rehab or training day.", Annotations: &write}, s.addDaySessionTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "remove_day_session", Description: "Remove one session from a specific ISO date's day override (materializes the weekly plan into an override first when needed).", Annotations: &write}, s.removeDaySessionTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "get_bodyweight", Description: "Read bodyweight history, including profile unit and goal.", Annotations: &read}, s.getBodyweightTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "log_bodyweight", Description: "Log bodyweight in the profile's unit; optional tz controls today's local date.", Annotations: &bwWrite}, s.logBodyweightTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "get_history", Description: "Browse completed workout history newest first, with per-set weight×reps, last working weight, and whether the target was hit.", Annotations: &read}, s.getHistoryTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "get_workouts", Description: "List raw completed workouts newest first.", Annotations: &read}, s.getWorkoutsTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "log_workout", Description: "Append one completed workout object in the web app's stored shape. Working sets on loaded lifts need a weight greater than 0. Progression stays keyed to routineId.", Annotations: &workoutWrite}, s.logWorkoutTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "log_exercise_sets", Description: "Log one exercise's working sets (exercise id, date, [{w, r, done}]). Updates the source routine's working weight. Supply a distinct workoutId for each separate session of the same routine on a date; reuse it for subsequent exercises or corrections. Without workoutId, updates the latest workout for that date and routine.", Annotations: &workoutWrite}, s.logExerciseSetsTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "next_workout_suggestion", Description: "Suggest a workout from a server-built training digest (requires OPENROUTER_API_KEY).", Annotations: &openWorldRead}, s.nextWorkoutSuggestionTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "get_strength_progress", Description: "Return the estimated one-rep-max trend and best source set for an exercise.", Annotations: &read}, s.getStrengthProgressTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "get_muscle_balance", Description: "Summarize recent muscle loading; days accepts 0, 7, 30, or 90 and defaults to 30.", Annotations: &read}, s.getMuscleBalanceTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "get_next_progression", Description: "Return the next actionable progression for an exercise; provide routineId when an exercise appears in multiple routines.", Annotations: &read}, s.getNextProgressionTool)
	mcp.AddTool(srv, &mcp.Tool{Name: "get_session_prescription", Description: "Today's coaching prescription for every session: last working-set performance, next sets×reps×weight, and increased/held/deload with a one-line reason. Warm-ups are ignored. Sessions are not flattened.", Annotations: &read}, s.getSessionPrescriptionTool)
	s.registerGarminMCP(srv)
	return srv
}

func (s *Server) mcpHandler() http.Handler {
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return s.mcpServer() }, &mcp.StreamableHTTPOptions{Stateless: true})
	metaURL := ""
	if s.OAuth != nil {
		metaURL = s.OAuth.ResourceMetadataURL()
	}
	return mcpauth.RequireBearerToken(s.verifyMCPToken, &mcpauth.RequireBearerTokenOptions{ResourceMetadataURL: metaURL})(handler)
}

func (s *Server) mcpServer() *mcp.Server {
	s.mcpOnce.Do(func() { s.mcpSrv = s.buildMCPServer() })
	return s.mcpSrv
}
