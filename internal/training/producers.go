package training

import (
	"slices"
	"strconv"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/exercises"
)

// trainingDay resolves a calendar date from the closed MCP state graph.
// Overrides take precedence over the weekly schedule, but invalid overrides
// intentionally fall back to the weekly slot to match the web application.
func trainingDay(view TrainingData, iso string) MCPTodayResult {
	if iso == "" {
		iso = todayISOLocal("", time.Now())
	}
	weekday := weekdayKey(iso)
	out := MCPTodayResult{
		Iso:       iso,
		Weekday:   weekday,
		Sessions:  []MCPTodaySession{},
		WeekSlots: weekSlotSessions(view.Week, weekday),
	}

	sessions, override, rest := resolveDaySessions(view, iso)
	out.Override = override
	if rest {
		out.Rest = true
		return out
	}
	if len(sessions) == 0 {
		out.Rest = true
		return out
	}

	out.Sessions = make([]MCPTodaySession, 0, len(sessions))
	for _, session := range sessions {
		routine, found := findRoutineByID(view.Routines, session.RoutineID)
		if !found {
			continue
		}
		prescribed := prescribeRoutine(view, routine)
		row := MCPTodaySession{
			RoutineID: session.RoutineID,
			Start:     session.Start,
			Label:     session.Label,
			Routine:   &prescribed,
		}
		out.Sessions = append(out.Sessions, row)
	}
	if len(out.Sessions) == 0 {
		out.Rest = true
	}
	return out
}

func findRoutineByID(routines []MCPRoutine, id string) (MCPRoutine, bool) {
	for _, routine := range routines {
		if routine.ID == id {
			return routine, true
		}
	}
	return MCPRoutine{}, false
}

func buildTrainingDigest(view TrainingData, sessions []MCPDaySession, today string) MCPTrainingDigest {
	unit := view.Unit
	if unit == "" {
		unit = "kg"
	}

	bwStart := 0
	if len(view.Bodyweight) > 10 {
		bwStart = len(view.Bodyweight) - 10
	}
	bodyweight := make([]MCPBodyweightEntry, 0, len(view.Bodyweight)-bwStart)
	for _, entry := range view.Bodyweight[bwStart:] {
		// The coaching digest intentionally carries only date and weight. The
		// persisted timestamp is useful to the history API but is not part of
		// the digest contract used by the model.
		bodyweight = append(bodyweight, MCPBodyweightEntry{D: entry.D, W: entry.W})
	}

	digestSessions := make([]MCPTrainingDigestSession, 0, len(sessions))
	for _, session := range sessions {
		routine, found := findRoutineByID(view.Routines, session.RoutineID)
		if !found {
			continue
		}
		prescribed := prescribeRoutine(view, routine)
		entries := make([]MCPDigestExerciseEntry, 0, len(prescribed.Ex))
		for _, config := range prescribed.Ex {
			entry := MCPDigestExerciseEntry{
				ID:         config.ID,
				Name:       mcpExerciseName(config.ID, view.CustomEx),
				Sets:       config.Sets,
				Reps:       config.Reps,
				Weight:     config.Weight,
				Sec:        config.Sec,
				Min:        config.Min,
				Speed:      config.Speed,
				Bodyweight: config.Bodyweight,
				Side:       config.Side,
			}
			if hint, ok := view.ExWeights[config.ID]; ok {
				entry.LastWeight = new(hint.W)
			}
			entries = append(entries, entry)
		}
		digestSessions = append(digestSessions, MCPTrainingDigestSession{
			RoutineID: session.RoutineID,
			Name:      routine.Name,
			Start:     session.Start,
			Label:     session.Label,
			Entries:   entries,
		})
	}

	workoutStart := 0
	if len(view.Workouts) > 8 {
		workoutStart = len(view.Workouts) - 8
	}
	lastWorkouts := make([]MCPDigestWorkout, 0, len(view.Workouts)-workoutStart)
	for _, workout := range view.Workouts[workoutStart:] {
		entries := make([]MCPDigestWorkoutEntry, 0, len(workout.Entries))
		for _, logged := range workout.Entries {
			digestSets := make([]string, 0, len(logged.Sets))
			for _, set := range logged.Sets {
				if value := formatLoggedSet(set, unit); value != "" {
					digestSets = append(digestSets, value)
				}
			}
			entries = append(entries, MCPDigestWorkoutEntry{
				ID:     logged.ID,
				Name:   mcpExerciseName(logged.ID, view.CustomEx),
				Target: logged.Target,
				Sets:   digestSets,
			})
		}
		lastWorkouts = append(lastWorkouts, MCPDigestWorkout{
			D:       workout.D,
			Name:    workout.Name,
			BW:      workout.BW,
			Entries: entries,
		})
	}

	return MCPTrainingDigest{
		Unit:           unit,
		Today:          today,
		BodyweightGoal: view.TargetW,
		Bodyweight:     bodyweight,
		Sessions:       digestSessions,
		LastWorkouts:   lastWorkouts,
	}
}

// buildHistory returns the compact, newest-first history representation
// used by MCP. Filtering only changes entries in the selected workout; it does
// not alter the stored workout or its volume/PR metadata.
func buildHistory(view TrainingData, q historyQuery) []MCPHistoryRow {
	limit := q.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	unit := view.Unit
	if unit == "" {
		unit = "kg"
	}

	out := make([]MCPHistoryRow, 0, limit)
	for i := len(view.Workouts) - 1; i >= 0 && len(out) < limit; i-- {
		workout := view.Workouts[i]
		if q.Since != "" && workout.D < q.Since {
			continue
		}
		if q.Until != "" && workout.D > q.Until {
			continue
		}
		if q.ExerciseID != "" && !workoutHasExercise(workout, q.ExerciseID) {
			continue
		}

		entries := make([]MCPHistoryEntry, 0, len(workout.Entries))
		for _, logged := range workout.Entries {
			if q.ExerciseID != "" && logged.ID != q.ExerciseID {
				continue
			}
			sets := make([]string, 0, len(logged.Sets))
			for _, set := range logged.Sets {
				if value := formatLoggedSet(set, unit); value != "" {
					sets = append(sets, value)
				}
			}
			row := MCPHistoryEntry{ID: logged.ID, Name: mcpExerciseName(logged.ID, view.CustomEx), Sets: sets}
			if last := sessionWorkingWeight(logged, progressionConfig{}); last > 0 {
				row.LastWeight = new(last)
			}
			session := readLoggedSession(logged, progressionConfigFromMCP(MCPExConfig{ID: logged.ID}))
			if logged.Target != nil {
				session = readLoggedSession(logged, progressionConfigFromMCP(*logged.Target))
			}
			row.Hit = new(session.ok)
			entries = append(entries, row)
		}

		row := MCPHistoryRow{ID: workout.ID, D: workout.D, Name: workout.Name, Vol: workout.Vol, Entries: entries}
		if len(workout.PRs) > 0 {
			row.PRs = slices.Clone(workout.PRs)
		}
		row.BW = workout.BW
		out = append(out, row)
	}
	return out
}

func workoutHasExercise(workout MCPWorkout, exerciseID string) bool {
	for _, entry := range workout.Entries {
		if entry.ID == exerciseID {
			return true
		}
	}
	return false
}

func mcpExerciseName(id string, custom []MCPCustomExercise) string {
	for _, exercise := range custom {
		if exercise.ID == id && exercise.N != "" {
			return exercise.N
		}
	}
	if exercise, ok := exercises.Lookup(id); ok {
		return exercise.N
	}
	return id
}

// catalogCustomExercises intentionally drops storage-only custom
// exercise fields before combining them with the catalog.
func catalogCustomExercises(view TrainingData) []exercises.Exercise {
	out := make([]exercises.Exercise, 0, len(view.CustomEx))
	for _, custom := range view.CustomEx {
		if custom.ID == "" || custom.N == "" {
			continue
		}
		out = append(out, exercises.Exercise{ID: custom.ID, N: custom.N, BP: custom.BP, EQ: custom.EQ, TG: custom.TG})
	}
	return out
}

func searchExercises(view TrainingData, query string, filters exercises.SearchFilters) []MCPExerciseSearchResult {
	hits := exercises.Search(query, catalogCustomExercises(view), filters)
	out := make([]MCPExerciseSearchResult, 0, len(hits))
	for _, hit := range hits {
		row := MCPExerciseSearchResult{ID: hit.ID, N: hit.N}
		if hit.BP != "" {
			row.BP = new(hit.BP)
		}
		if hit.EQ != "" {
			row.EQ = new(hit.EQ)
		}
		if hit.TG != "" {
			row.TG = new(hit.TG)
		}
		out = append(out, row)
	}
	return out
}

func formatLoggedSet(logged MCPLoggedSet, unit string) string {
	if !logged.Done {
		return ""
	}
	wu := ""
	if logged.WU != nil && *logged.WU {
		wu = "WU "
	}
	if logged.Sec != nil {
		prefix := ""
		if logged.W != nil && *logged.W != 0 {
			prefix = formatMCPNumber(*logged.W) + unit + "×"
		}
		return wu + prefix + formatMCPNumberPtr(logged.Sec) + "s"
	}
	if logged.Min != nil {
		speed := "?"
		if logged.Speed != nil {
			speed = formatMCPNumberPtr(logged.Speed)
		}
		return wu + formatMCPNumberPtr(logged.Min) + "min@" + speed
	}
	weight := "0"
	if logged.W != nil {
		weight = formatMCPNumber(*logged.W)
	}
	if logged.R == nil {
		return wu + weight
	}
	return wu + weight + "×" + formatMCPNumber(*logged.R)
}

func formatMCPNumberPtr(value *float64) string {
	if value == nil {
		return ""
	}
	return formatMCPNumber(*value)
}

func formatMCPNumber(value float64) string {
	if value == float64(int64(value)) {
		return strconv.FormatInt(int64(value), 10)
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}
