package training

import (
	"crypto/rand"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/validation"
)

func cloneFloat(v *float64) *float64 {
	if v == nil {
		return nil
	}
	return new(*v)
}

func cloneString(v *string) *string {
	if v == nil {
		return nil
	}
	return new(*v)
}

func cloneBool(v *bool) *bool {
	if v == nil {
		return nil
	}
	return new(*v)
}

func cloneExConfig(cfg MCPExConfig) MCPExConfig {
	return MCPExConfig{
		Fivefold: cfg.Fivefold, ID: cfg.ID, Sets: cloneFloat(cfg.Sets), Mode: cloneString(cfg.Mode),
		Reps: cloneFloat(cfg.Reps), Weight: cloneFloat(cfg.Weight), Sec: cloneFloat(cfg.Sec),
		Min: cloneFloat(cfg.Min), Speed: cloneFloat(cfg.Speed), Bodyweight: cloneBool(cfg.Bodyweight),
		Side: cloneBool(cfg.Side), Prog: cloneString(cfg.Prog), Inc: cloneFloat(cfg.Inc),
		RepsMin: cloneFloat(cfg.RepsMin), RepsMax: cloneFloat(cfg.RepsMax), Sg: cloneString(cfg.Sg),
	}
}

func cloneRoutine(routine MCPRoutine) MCPRoutine {
	out := MCPRoutine{
		ID: routine.ID, Name: routine.Name, Emoji: routine.Emoji, Prog: cloneString(routine.Prog),
		Ex: make([]MCPExConfig, len(routine.Ex)), SessionPlan: cloneSessionPlan(routine.SessionPlan),
	}
	for i, cfg := range routine.Ex {
		out.Ex[i] = cloneExConfig(cfg)
	}
	return out
}

func cloneSessionPlan(plan *MCPSessionPlan) *MCPSessionPlan {
	if plan == nil {
		return nil
	}
	out := *plan
	out.Equipment = append([]string{}, plan.Equipment...)
	out.Rows = make([]MCPSessionPlanRow, len(plan.Rows))
	for i, row := range plan.Rows {
		out.Rows[i].Original = cloneExConfig(row.Original)
		if row.Planned != nil {
			config := cloneExConfig(*row.Planned)
			out.Rows[i].Planned = &config
		}
	}
	return &out
}

func applyProgressionToConfig(cfg MCPExConfig, prescription MCPProgression) MCPExConfig {
	if prescription.Kind == "off" {
		return cfg
	}
	out := cloneExConfig(cfg)
	if prescription.Weight != nil {
		out.Weight = cloneFloat(prescription.Weight)
	}
	if prescription.Reps != nil {
		out.Reps = cloneFloat(prescription.Reps)
	}
	if prescription.Sets != nil {
		out.Sets = cloneFloat(prescription.Sets)
	}
	if prescription.Sec != nil {
		out.Sec = cloneFloat(prescription.Sec)
	}
	return out
}

func lastLoggedWorkingWeight(view TrainingData, exerciseID string) float64 {
	for _, workout := range slices.Backward(view.Workouts) {
		for _, entry := range workout.Entries {
			if entry.ID != exerciseID {
				continue
			}
			if w := sessionWorkingWeight(entry, progressionConfig{}); w > 0 {
				return w
			}
		}
	}
	if hint, ok := view.ExWeights[exerciseID]; ok && hint.W > 0 {
		return hint.W
	}
	return 0
}

func fillConfigWeight(view TrainingData, cfg MCPExConfig, prescription MCPProgression) MCPExConfig {
	out := applyProgressionToConfig(cfg, prescription)
	if floatPointerValue(out.Weight) > 0 {
		return out
	}
	if last := lastLoggedWorkingWeight(view, cfg.ID); last > 0 {
		out.Weight = new(last)
	}
	return out
}

// prescribeRoutine returns a copy of the routine with next working weights
// filled in from history. It does not mutate the stored program.
func prescribeRoutine(view TrainingData, routine MCPRoutine) MCPRoutine {
	out := cloneRoutine(routine)
	for i, cfg := range out.Ex {
		out.Ex[i] = fillConfigWeight(view, cfg, NextProgression(view, cfg, routine))
	}
	return out
}

func persistExWeightHints(data *TrainingData, workout MCPWorkout) {
	if data.ExWeights == nil {
		data.ExWeights = map[string]MCPExWeightHint{}
	}
	for _, entry := range workout.Entries {
		weight := sessionWorkingWeight(entry, progressionConfig{})
		if weight <= 0 {
			continue
		}
		current, ok := data.ExWeights[entry.ID]
		if !ok || weight > current.W {
			data.ExWeights[entry.ID] = MCPExWeightHint{W: weight, D: workout.D}
		}
	}
}

func findRoutineExercise(data *TrainingData, routineID, exerciseID string) (int, int, bool) {
	if routineID != "" {
		for i := range data.Routines {
			if data.Routines[i].ID != routineID {
				continue
			}
			for j := range data.Routines[i].Ex {
				if data.Routines[i].Ex[j].ID == exerciseID {
					return i, j, true
				}
			}
			return 0, 0, false
		}
		return 0, 0, false
	}
	matches := 0
	ri, ei := 0, 0
	for i := range data.Routines {
		for j := range data.Routines[i].Ex {
			if data.Routines[i].Ex[j].ID == exerciseID {
				matches++
				ri, ei = i, j
			}
		}
	}
	return ri, ei, matches == 1
}

// persistRoutineWorkingWeights writes the next prescription onto the source
// routine after a workout is saved. Exercise order, names, and unlogged lifts
// are left alone.
func persistRoutineWorkingWeights(data *TrainingData, workout MCPWorkout) {
	persistExWeightHints(data, workout)
	routineID := stringPointerValue(workout.RoutineID)
	for _, entry := range workout.Entries {
		ri, ei, ok := findRoutineExercise(data, routineID, entry.ID)
		if !ok {
			continue
		}
		cfg := data.Routines[ri].Ex[ei]
		if stringPointerValue(cfg.Prog) == "fivefold" || stringPointerValue(data.Routines[ri].Prog) == "fivefold" {
			if slices.Contains(workout.ProgressionApplied, entry.ID) {
				continue
			}
			updated := advanceFivefoldConfig(cfg, entry, workout.ID, data.Unit)
			if routineID == "fivefold-A" {
				data.FivefoldNext = "B"
			} else if routineID == "fivefold-B" {
				data.FivefoldNext = "A"
			}
			for i := range data.Workouts {
				if data.Workouts[i].ID == workout.ID {
					data.Workouts[i].ProgressionApplied = append(data.Workouts[i].ProgressionApplied, entry.ID)
					break
				}
			}
			for r := range data.Routines {
				if stringPointerValue(data.Routines[r].Prog) != "fivefold" {
					continue
				}
				for e := range data.Routines[r].Ex {
					if data.Routines[r].Ex[e].ID == entry.ID {
						data.Routines[r].Ex[e].Weight = updated.Weight
						data.Routines[r].Ex[e].Fivefold = updated.Fivefold
					}
				}
			}
			continue
		}
		prescription := NextProgression(*data, cfg, data.Routines[ri])
		updated := fillConfigWeight(*data, cfg, prescription)
		if floatPointerValue(updated.Weight) == 0 {
			if last := sessionWorkingWeight(entry, progressionConfigFromMCP(cfg)); last > 0 {
				updated.Weight = new(last)
			}
		}
		data.Routines[ri].Ex[ei] = updated
	}
}

func lastPerformance(view TrainingData, exerciseID string, fallback MCPExConfig) *MCPLastPerformance {
	for _, workout := range slices.Backward(view.Workouts) {
		for _, entry := range workout.Entries {
			if entry.ID != exerciseID {
				continue
			}
			working := workingSets(entry.Sets)
			hasDone := false
			sets := make([]string, 0, len(working))
			unit := view.Unit
			if unit == "" {
				unit = "lb"
			}
			for _, set := range working {
				if !set.Done {
					continue
				}
				hasDone = true
				if label := formatLoggedSet(set, unit); label != "" {
					sets = append(sets, label)
				}
			}
			if !hasDone {
				continue
			}
			session := readLoggedSession(entry, progressionConfigFromMCP(fallback))
			return &MCPLastPerformance{
				Date:   workout.D,
				Sets:   sets,
				Weight: session.weight,
				Hit:    session.ok,
			}
		}
	}
	return nil
}

func readLoggedSession(entry MCPWorkoutEntry, fallback progressionConfig) progressionSession {
	sessions := progressionSessions(TrainingData{Workouts: []MCPWorkout{{Entries: []MCPWorkoutEntry{entry}}}}, entry.ID, fallback)
	if len(sessions) == 0 {
		return progressionSession{}
	}
	return sessions[0]
}

func prescriptionDecision(kind string) string {
	switch kind {
	case "up":
		return "increased"
	case "hold":
		return "held"
	case "deload":
		return "deload"
	case "first":
		return "first"
	default:
		return "off"
	}
}

func nextTargetFrom(cfg MCPExConfig, prescription MCPProgression) MCPNextTarget {
	filled := applyProgressionToConfig(cfg, prescription)
	return MCPNextTarget{Sets: filled.Sets, Reps: filled.Reps, Weight: filled.Weight, Sec: filled.Sec}
}

// sessionPrescription is the coaching read: today's sessions, last working
// sets, next target, and why. Warm-ups are excluded from the decision.
func sessionPrescription(view TrainingData, iso string) MCPDayPrescription {
	today := trainingDay(view, iso)
	unit := view.Unit
	if unit == "" {
		unit = "lb"
	}
	out := MCPDayPrescription{Iso: today.Iso, Unit: unit, Rest: today.Rest, Sessions: []MCPSessionPrescription{}}
	if today.Rest || len(today.Sessions) == 0 {
		return out
	}
	out.Sessions = make([]MCPSessionPrescription, 0, len(today.Sessions))
	for _, session := range today.Sessions {
		if session.Routine == nil {
			continue
		}
		routine := *session.Routine
		row := MCPSessionPrescription{
			RoutineID:   session.RoutineID,
			RoutineName: routine.Name,
			Start:       session.Start,
			Label:       session.Label,
			Policy:      cloneString(routine.Prog),
			Exercises:   []MCPExercisePrescription{},
		}
		if row.Policy == nil {
			row.Policy = new("linear")
		}
		row.Exercises = make([]MCPExercisePrescription, 0, len(routine.Ex))
		for _, cfg := range routine.Ex {
			prescription := NextProgression(view, cfg, routine)
			reason := ""
			if prescription.Reason != nil {
				reason = *prescription.Reason
			}
			next := nextTargetFrom(cfg, prescription)
			if floatPointerValue(next.Weight) == 0 {
				if last := lastLoggedWorkingWeight(view, cfg.ID); last > 0 {
					next.Weight = new(last)
				}
			}
			row.Exercises = append(row.Exercises, MCPExercisePrescription{
				ID: cfg.ID, Name: mcpExerciseName(cfg.ID, view.CustomEx),
				Last: lastPerformance(view, cfg.ID, cfg), Next: next,
				Decision: prescriptionDecision(prescription.Kind), Reason: reason,
			})
		}
		out.Sessions = append(out.Sessions, row)
	}
	return out
}

func validateLoadedWorkingSets(workout MCPWorkout) error {
	for _, entry := range workout.Entries {
		cfg := MCPExConfig{ID: entry.ID}
		if entry.Target != nil {
			cfg = *entry.Target
		}
		if !isLoadedRepsExercise(cfg) {
			continue
		}
		for i, set := range workingSets(entry.Sets) {
			if !set.Done {
				continue
			}
			if set.W == nil || *set.W <= 0 {
				return fmt.Errorf("working set %d of %s needs a weight greater than 0", i+1, entry.ID)
			}
		}
	}
	return nil
}

func workoutVolumeOf(workout MCPWorkout) float64 {
	vol := 0.0
	for _, entry := range workout.Entries {
		for _, set := range workingSets(entry.Sets) {
			if !set.Done || set.W == nil || set.R == nil {
				continue
			}
			vol += *set.W * *set.R
		}
	}
	return vol
}

func resolveLogDate(d, tz *string, now time.Time) (string, error) {
	date := ""
	if d != nil {
		date = strings.TrimSpace(*d)
	}
	if date != "" && !ValidISODate(date) {
		return "", errors.New("date must be YYYY-MM-DD")
	}
	if tz != nil && strings.TrimSpace(*tz) == "" {
		return "", errors.New("timezone must not be empty")
	}
	if date == "" {
		zone := ""
		if tz != nil {
			zone = *tz
		}
		date = todayISOLocal(zone, now)
	}
	return date, nil
}

func logExerciseSets(data *TrainingData, input MCPLogExerciseSetsInput, now time.Time) (MCPWorkout, MCPProgression, error) {
	exerciseID := strings.TrimSpace(input.ExerciseID)
	if exerciseID == "" {
		return MCPWorkout{}, MCPProgression{}, errors.New("exerciseId must not be empty")
	}
	if len(input.Sets) == 0 {
		return MCPWorkout{}, MCPProgression{}, errors.New("at least one working set is required")
	}
	date, err := resolveLogDate(input.D, input.Tz, now)
	if err != nil {
		return MCPWorkout{}, MCPProgression{}, err
	}
	routineID := ""
	if input.RoutineID != nil {
		routineID = strings.TrimSpace(*input.RoutineID)
		if routineID == "" {
			return MCPWorkout{}, MCPProgression{}, errors.New("routineId must not be empty")
		}
	}
	ri, ei, ok := findRoutineExercise(data, routineID, exerciseID)
	var cfg MCPExConfig
	var routine MCPRoutine
	if ok {
		routine = data.Routines[ri]
		cfg = cloneExConfig(routine.Ex[ei])
		routineID = routine.ID
	} else if routineID != "" {
		return MCPWorkout{}, MCPProgression{}, fmt.Errorf("exercise %q not found in routine %q", exerciseID, routineID)
	} else {
		cfg = MCPExConfig{ID: exerciseID}
	}
	if isLoadedRepsExercise(cfg) {
		for i, set := range input.Sets {
			if set.W == nil || *set.W <= 0 {
				return MCPWorkout{}, MCPProgression{}, fmt.Errorf("working set %d of %s needs a weight greater than 0", i+1, exerciseID)
			}
		}
	}
	logged := make([]MCPLoggedSet, 0, len(input.Sets))
	for _, set := range input.Sets {
		done := true
		if set.Done != nil {
			done = *set.Done
		}
		loggedSet := MCPLoggedSet{Done: done, W: cloneFloat(set.W), R: new(set.R)}
		logged = append(logged, loggedSet)
	}
	if cfg.Sets == nil {
		cfg.Sets = new(float64(len(logged)))
	}
	if cfg.Reps == nil && len(logged) > 0 {
		cfg.Reps = new(input.Sets[0].R)
	}
	if floatPointerValue(cfg.Weight) == 0 {
		for _, set := range logged {
			if set.Done && set.W != nil && *set.W > 0 {
				cfg.Weight = cloneFloat(set.W)
				break
			}
		}
	}
	entry := MCPWorkoutEntry{ID: exerciseID, Sets: logged, Target: &cfg}
	workout, found, err := workoutForExerciseSets(data.Workouts, date, routineID, input.WorkoutID)
	if err != nil {
		return MCPWorkout{}, MCPProgression{}, err
	}
	if !found {
		name := "Workout"
		if routine.Name != "" {
			name = routine.Name
		}
		nowMs := now.UnixMilli()
		workout = MCPWorkout{
			ID: "w" + rand.Text(), D: date, Start: nowMs, End: nowMs,
			Name: name, Entries: []MCPWorkoutEntry{}, PRs: []string{},
		}
		if input.WorkoutID != nil {
			workout.ID = strings.TrimSpace(*input.WorkoutID)
		}
		if routineID != "" {
			workout.RoutineID = new(routineID)
		}
	}
	replaced := false
	for i := range workout.Entries {
		if workout.Entries[i].ID == exerciseID {
			workout.Entries[i] = entry
			replaced = true
			break
		}
	}
	if !replaced {
		workout.Entries = append(workout.Entries, entry)
	}
	workout.End = now.UnixMilli()
	workout.Vol = workoutVolumeOf(workout)
	replacedStored := false
	for i := range data.Workouts {
		if data.Workouts[i].ID == workout.ID {
			data.Workouts[i] = workout
			replacedStored = true
			break
		}
	}
	if !replacedStored {
		data.Workouts = append(data.Workouts, workout)
	}
	persistRoutineWorkingWeights(data, workout)
	next := NextProgression(*data, cfg, routine)
	return workout, next, nil
}

func findSameDayWorkout(workouts []MCPWorkout, date, routineID string) (MCPWorkout, bool) {
	for _, workout := range slices.Backward(workouts) {
		if workout.D != date {
			continue
		}
		if stringPointerValue(workout.RoutineID) == routineID {
			return workout, true
		}
	}
	return MCPWorkout{}, false
}

// An explicit workout id makes repeated sessions distinguishable and retries
// idempotent. Omitted ids retain the date-and-routine grouping for existing callers.
func workoutForExerciseSets(workouts []MCPWorkout, date, routineID string, id *string) (MCPWorkout, bool, error) {
	if id == nil {
		workout, found := findSameDayWorkout(workouts, date, routineID)
		return workout, found, nil
	}
	normalized := strings.TrimSpace(*id)
	if validation.Validator.Var(normalized, "required,max=40") != nil {
		return MCPWorkout{}, false, errors.New("workoutId must be a non-empty id up to 40 characters")
	}
	for _, workout := range workouts {
		if workout.ID != normalized {
			continue
		}
		if workout.D != date || stringPointerValue(workout.RoutineID) != routineID {
			return MCPWorkout{}, false, errors.New("workoutId belongs to a different date or routine; use that workout's date and routineId, or a new workoutId")
		}
		return workout, true, nil
	}
	return MCPWorkout{}, false, nil
}
