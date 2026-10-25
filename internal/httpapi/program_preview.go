package httpapi

import (
	"fmt"
	"maps"
	"math"
	"reflect"
	"regexp"
	"slices"
	"strings"

	"github.com/aranlucas/set-and-signal-unified/internal/validation"
)

type typedPreparedProgram struct {
	routines []MCPRoutine
	week     MCPWeekSchedule
	hasWeek  bool
}

func prepareTypedProgram(routines []MCPRoutineInput, week MCPWeekSchedule) (typedPreparedProgram, error) {
	if err := validation.Validator.Var(routines, "required,min=1,max=21"); err != nil {
		return typedPreparedProgram{}, err
	}
	prepared := typedPreparedProgram{routines: make([]MCPRoutine, 0, len(routines)), hasWeek: week != nil}
	seen := map[string]bool{}
	for i, input := range routines {
		routine, err := normalizeRoutine(input)
		if err != nil {
			return typedPreparedProgram{}, fmt.Errorf("routine %d: %w", i, err)
		}
		if seen[routine.ID] {
			return typedPreparedProgram{}, fmt.Errorf("duplicate routine id %s", routine.ID)
		}
		seen[routine.ID] = true
		prepared.routines = append(prepared.routines, routine)
	}
	var err error
	prepared.week, err = normalizeWeek(week)
	return prepared, err
}

var programSlugRe = regexp.MustCompile(`[^a-z0-9]+`)

// Normalization is shared by REST and MCP; field constraints live on the DTOs.
func normalizeRoutine(input MCPRoutineInput) (MCPRoutine, error) {
	input.Name = strings.TrimSpace(input.Name)
	id := strings.TrimSpace(inputString(input.ID))
	if input.ID == nil || *input.ID == "" {
		id = programSlugRe.ReplaceAllString(strings.ToLower(input.Name), "")
		if id == "" {
			id = "routine"
		}
		id = string([]rune(id)[:min(len(id), 40)])
	}
	input.ID = new(id)
	input.Ex = slices.Clone(input.Ex)
	for i := range input.Ex {
		input.Ex[i].ID = strings.TrimSpace(input.Ex[i].ID)
	}
	if err := validation.Validator.Struct(input); err != nil {
		return MCPRoutine{}, err
	}
	routine := MCPRoutine{ID: id, Name: input.Name, Emoji: inputString(input.Emoji), Prog: input.Prog, Ex: input.Ex}
	if routine.Ex == nil {
		routine.Ex = []MCPExConfig{}
	}
	for i := range routine.Ex {
		entry := &routine.Ex[i]
		for _, field := range []**float64{&entry.Sets, &entry.Reps, &entry.Weight, &entry.Sec, &entry.Min, &entry.Speed, &entry.Inc, &entry.RepsMin, &entry.RepsMax} {
			if *field != nil {
				*field = new(roundHundredths(**field))
			}
		}
	}
	return routine, nil
}

func normalizeWeek(week MCPWeekSchedule) (MCPWeekSchedule, error) {
	if err := validation.Validator.Var(week, "dive,keys,oneof=0 1 2 3 4 5 6,endkeys"); err != nil {
		return nil, err
	}
	if week == nil {
		return nil, nil
	}
	out := MCPWeekSchedule{}
	for day, sessions := range week {
		out[day] = make([]MCPDaySession, 0, len(sessions))
		for _, session := range sessions {
			normalized, err := trainingNormalizeDaySession(session)
			if err != nil {
				return nil, fmt.Errorf("week[%s]: %w", day, err)
			}
			out[day] = append(out[day], normalized)
		}
	}
	return out, nil
}

func inputString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func roundHundredths(value float64) float64 { return math.Floor(value*100+0.5) / 100 }

func cloneMCPRoutines(value []MCPRoutine) []MCPRoutine {
	return slices.Clone(value)
}

func cloneMCPWeek(week MCPWeekSchedule) MCPWeekSchedule {
	return trainingCloneWeek(week)
}

func typedApplyProgram(current []MCPRoutine, week MCPWeekSchedule, prepared typedPreparedProgram, replace bool) typedPreparedProgram {
	out := typedPreparedProgram{routines: cloneMCPRoutines(current), week: cloneMCPWeek(week), hasWeek: prepared.hasWeek}
	if replace {
		out.routines = []MCPRoutine{}
		out.week = MCPWeekSchedule{}
	}
	for _, routine := range prepared.routines {
		replaced := false
		for i := range out.routines {
			if out.routines[i].ID == routine.ID {
				out.routines[i], replaced = routine, true
				break
			}
		}
		if !replaced {
			out.routines = append(out.routines, routine)
		}
	}
	if prepared.hasWeek {
		out.week = cloneMCPWeek(prepared.week)
		ids := map[string]bool{}
		for _, routine := range out.routines {
			ids[routine.ID] = true
		}
		for day, sessions := range out.week {
			kept := sessions[:0]
			for _, session := range sessions {
				if ids[session.RoutineID] {
					kept = append(kept, session)
				}
			}
			if len(kept) == 0 {
				delete(out.week, day)
			} else {
				out.week[day] = kept
			}
		}
	}
	return out
}

func (s *Server) mutateTypedProgram(uid string, prepared typedPreparedProgram, replace bool, expectedRevision *int64) error {
	return NewTrainingDataRepository(s.ST).Mutate(uid, expectedRevision, func(data *TrainingData) error {
		applied := typedApplyProgram(data.Routines, data.Week, prepared, replace)
		data.Routines = applied.routines
		data.Week = applied.week
		if replace {
			for day, entry := range data.DayPlan {
				if !entry.Rest {
					delete(data.DayPlan, day)
				}
			}
		}
		return nil
	})
}

func routinesToInput(routines []MCPRoutine) []MCPRoutineInput {
	out := make([]MCPRoutineInput, 0, len(routines))
	for _, routine := range routines {
		input := MCPRoutineInput{ID: new(routine.ID), Name: routine.Name, Emoji: new(routine.Emoji), Ex: slices.Clone(routine.Ex)}
		if routine.Prog != nil {
			input.Prog = new(*routine.Prog)
		}
		out = append(out, input)
	}
	return out
}

func typedProgramDiff(before, after MCPProgramState) MCPProgramDiff {
	old := make(map[string]MCPRoutine, len(before.Routines))
	current := make(map[string]MCPRoutine, len(after.Routines))
	for _, routine := range before.Routines {
		old[routine.ID] = routine
	}
	for _, routine := range after.Routines {
		current[routine.ID] = routine
	}
	ids := make([]string, 0, len(old)+len(current))
	seen := map[string]bool{}
	for id := range old {
		ids = append(ids, id)
		seen[id] = true
	}
	for id := range current {
		if !seen[id] {
			ids = append(ids, id)
		}
	}
	slices.Sort(ids)
	diff := MCPProgramDiff{AddedRoutines: []MCPRoutineChange{}, UpdatedRoutines: []MCPRoutineUpdate{}, RemovedRoutines: []MCPRoutineChange{}, ScheduleChanges: []MCPScheduleChange{}}
	for _, id := range ids {
		beforeRoutine, hadBefore := old[id]
		afterRoutine, hadAfter := current[id]
		switch {
		case !hadBefore && hadAfter:
			diff.AddedRoutines = append(diff.AddedRoutines, MCPRoutineChange{ID: id, Routine: afterRoutine})
		case hadBefore && !hadAfter:
			diff.RemovedRoutines = append(diff.RemovedRoutines, MCPRoutineChange{ID: id, Routine: beforeRoutine})
		case !reflect.DeepEqual(beforeRoutine, afterRoutine):
			diff.UpdatedRoutines = append(diff.UpdatedRoutines, MCPRoutineUpdate{ID: id, Before: new(beforeRoutine), After: new(afterRoutine)})
		}
	}
	weekKeys := make(map[string]bool, len(before.Week)+len(after.Week))
	for day := range before.Week {
		weekKeys[day] = true
	}
	for day := range after.Week {
		weekKeys[day] = true
	}
	days := slices.Sorted(maps.Keys(weekKeys))
	for _, day := range days {
		beforeSessions, afterSessions := weekValue(before.Week, day), weekValue(after.Week, day)
		if trainingDaySessionsEqual(beforeSessions, afterSessions) {
			continue
		}
		diff.ScheduleChanges = append(diff.ScheduleChanges, MCPScheduleChange{Day: day, Before: beforeSessions, After: afterSessions})
	}
	diff.Summary = fmt.Sprintf("%d routines added, %d updated, %d removed, %d schedule changes", len(diff.AddedRoutines), len(diff.UpdatedRoutines), len(diff.RemovedRoutines), len(diff.ScheduleChanges))
	return diff
}

func weekValue(week MCPWeekSchedule, day string) []MCPDaySession {
	value, ok := week[day]
	if !ok || len(value) == 0 {
		return nil
	}
	return trainingCloneSessions(value)
}
