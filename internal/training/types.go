package training

// This file defines the shared HTTP and MCP training contracts. The persisted training
// document is decoded by TrainingDataRepository into a closed typed graph.
// Keep these DTOs boring: concrete fields make the generated JSON schemas
// useful to models and incompatible changes visible at compile time.

// MCPExerciseSearchResult is the compact exercise shape returned by search.
// The catalog has richer fields, but these are the fields a program author
// needs in order to select an exercise.
type MCPExerciseSearchResult struct {
	ID string  `json:"id"`
	N  string  `json:"n"`
	BP *string `json:"bp,omitempty"`
	EQ *string `json:"eq,omitempty"`
	TG *string `json:"tg,omitempty"`
}

// MCPExConfig is a planned exercise. Numeric fields are pointers
// because the web product distinguishes an omitted field from zero (for
// example, a timed exercise has sec while a reps exercise has reps).
type FivefoldPolicyState struct {
	Unit          string  `json:"unit,omitempty"`
	Failures      int     `json:"failures"`
	Bar           float64 `json:"bar"`
	AutoProgress  bool    `json:"autoProgress"`
	AutoDeload    bool    `json:"autoDeload"`
	LastWorkoutID string  `json:"lastWorkoutId,omitempty"`
}

type MCPExConfig struct {
	Fivefold   *FivefoldPolicyState `json:"fivefold,omitempty"`
	ID         string               `json:"id" jsonschema:"exercise catalog id" validate:"required,max=200"`
	Sets       *float64             `json:"sets,omitzero" jsonschema:"number of working sets" validate:"omitempty,gte=1,lte=12"`
	Mode       *string              `json:"mode,omitempty" jsonschema:"exercise mode: reps or time" validate:"omitempty,oneof=reps time"`
	Reps       *float64             `json:"reps,omitzero" jsonschema:"target repetitions per set" validate:"omitempty,gte=1,lte=500"`
	Weight     *float64             `json:"weight,omitzero" jsonschema:"target weight in the profile unit" validate:"omitempty,gte=0,lte=1000"`
	Sec        *float64             `json:"sec,omitzero" jsonschema:"target seconds for a timed set" validate:"omitempty,gte=1,lte=7200"`
	Min        *float64             `json:"min,omitzero" jsonschema:"target minutes for a timed set" validate:"omitempty,gte=1,lte=600"`
	Speed      *float64             `json:"speed,omitzero" jsonschema:"target speed" validate:"omitempty,gte=0,lte=80"`
	Bodyweight *bool                `json:"bodyweight,omitzero" jsonschema:"whether the movement uses bodyweight"`
	Side       *bool                `json:"side,omitzero" jsonschema:"whether the target is performed per side"`
	Prog       *string              `json:"prog,omitempty" jsonschema:"progression policy" validate:"omitempty,oneof=off linear greyskull double time fivefold"`
	Inc        *float64             `json:"inc,omitzero" jsonschema:"weight or target increment after success" validate:"omitempty,gte=0,lte=200"`
	RepsMin    *float64             `json:"repsMin,omitzero" jsonschema:"minimum repetitions for double progression" validate:"omitempty,gte=1,lte=500"`
	RepsMax    *float64             `json:"repsMax,omitzero" jsonschema:"maximum repetitions for double progression" validate:"omitempty,gte=1,lte=500"`
	Sg         *string              `json:"sg,omitempty" jsonschema:"superset group id" validate:"omitempty,max=40"`
}

// MCPExConfigInput shares the planned exercise fields and validation rules.
type MCPExConfigInput = MCPExConfig

type MCPRoutine struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Emoji       string          `json:"emoji"`
	Prog        *string         `json:"prog,omitempty"`
	Ex          []MCPExConfig   `json:"ex"`
	SessionPlan *MCPSessionPlan `json:"sessionPlan,omitempty"`
}

// MCPSessionPlan retains the accepted adaptation and its original template.
type MCPSessionPlan struct {
	SourceID   string              `json:"sourceId"`
	SourceName string              `json:"sourceName"`
	Equipment  []string            `json:"equipment"`
	BudgetMin  float64             `json:"budgetMin"`
	RestSec    float64             `json:"restSec"`
	Rows       []MCPSessionPlanRow `json:"rows"`
}

type MCPSessionPlanRow struct {
	Original MCPExConfig  `json:"original"`
	Planned  *MCPExConfig `json:"planned"`
}

// MCPRoutineInput keeps fields minted by the server optional at input time.
type MCPRoutineInput struct {
	ID    *string            `json:"id,omitempty" jsonschema:"stable routine id; generated from name when omitted" validate:"omitempty,min=1,max=40"`
	Name  string             `json:"name" jsonschema:"human-readable routine name" validate:"required,max=60"`
	Emoji *string            `json:"emoji,omitempty" jsonschema:"optional routine icon key" validate:"omitempty,max=24"`
	Prog  *string            `json:"prog,omitempty" jsonschema:"default progression policy for the routine" validate:"omitempty,oneof=off linear greyskull double time fivefold"`
	Ex    []MCPExConfigInput `json:"ex,omitempty" jsonschema:"ordered planned exercises" validate:"max=30,dive"`
}

// MCPLoggedSet is the tagged-union superset used by the web app.  The stored
// JSON has no explicit mode discriminator, so a typed wire object represents
// the possible fields and uses pointers for fields absent in another mode.
type MCPLoggedSet struct {
	RecordedWeight *float64 `json:"recordedWeight,omitzero"`
	Done           bool     `json:"done" jsonschema:"whether the set was completed"`
	W              *float64 `json:"w,omitzero" jsonschema:"performed weight in the profile unit"`
	R              *float64 `json:"r,omitzero" jsonschema:"performed repetitions"`
	Sec            *float64 `json:"sec,omitzero" jsonschema:"performed seconds"`
	Min            *float64 `json:"min,omitzero" jsonschema:"performed minutes"`
	Speed          *float64 `json:"speed,omitzero" jsonschema:"performed speed"`
	RIR            *float64 `json:"rir,omitzero" jsonschema:"repetitions in reserve"`
	RPE            *float64 `json:"rpe,omitzero" jsonschema:"rating of perceived exertion"`
	WU             *bool    `json:"wu,omitzero" jsonschema:"whether this was a warm-up set"`
}

// MCPMuscleSnapshot retains custom-exercise metadata after the exercise is deleted.
type MCPMuscleSnapshot struct {
	N             string             `json:"n,omitempty"`
	BP            string             `json:"bp,omitempty"`
	MuscleWeights map[string]float64 `json:"muscleWeights,omitempty"`
}

type MCPWorkoutEntry struct {
	ID             string             `json:"id" jsonschema:"exercise id"`
	Sets           []MCPLoggedSet     `json:"sets" jsonschema:"performed sets"`
	TopW           *float64           `json:"topW,omitzero" jsonschema:"top performed weight"`
	Target         *MCPExConfig       `json:"target,omitempty" jsonschema:"planned target captured with the workout"`
	MuscleSnapshot *MCPMuscleSnapshot `json:"muscleSnapshot,omitempty" jsonschema:"exercise name and muscle weights retained for history"`
}

type MCPWorkoutSource struct {
	Provider     string `json:"provider" validate:"oneof=fivefold garmin set-and-signal"`
	ID           string `json:"id" validate:"required,max=255"`
	RecordedUnit string `json:"recordedUnit" validate:"oneof=kg lb"`
}

type MCPWorkout struct {
	ProgressionApplied []string          `json:"progressionApplied,omitempty"`
	GarminActivityIDs  []string          `json:"garminActivityIds,omitempty"`
	Source             *MCPWorkoutSource `json:"source,omitempty"`
	ID                 string            `json:"id" jsonschema:"stable workout id; an existing id is replaced" validate:"required,max=200"`
	D                  string            `json:"d" jsonschema:"workout date in YYYY-MM-DD" validate:"required,datetime=2006-01-02"`
	Start              int64             `json:"start" jsonschema:"start time as unix milliseconds"`
	End                int64             `json:"end" jsonschema:"end time as unix milliseconds"`
	RoutineID          *string           `json:"routineId,omitempty" jsonschema:"source routine id"`
	Name               string            `json:"name" jsonschema:"workout name" validate:"max=80"`
	BW                 *float64          `json:"bw,omitzero" jsonschema:"bodyweight at workout time"`
	Entries            []MCPWorkoutEntry `json:"entries" jsonschema:"exercise results"`
	PRs                []string          `json:"prs" jsonschema:"exercise ids with personal records"`
	Vol                float64           `json:"vol" jsonschema:"total workout volume"`
	Note               *string           `json:"note,omitempty" jsonschema:"optional workout note"`
	SessionPlan        *MCPSessionPlan   `json:"sessionPlan,omitempty"`
}

type MCPBodyweightEntry struct {
	D string  `json:"d" validate:"required,datetime=2006-01-02"`
	W float64 `json:"w" validate:"gte=20,lte=500"`
	T *int64  `json:"t,omitzero"`
}

type MCPDateInput struct {
	Iso *string `json:"iso,omitempty" jsonschema:"date in YYYY-MM-DD; defaults to today"`
	Tz  *string `json:"tz,omitempty" jsonschema:"IANA timezone used when resolving today"`
}

type MCPSearchExercisesInput struct {
	Q     string `json:"q,omitempty" jsonschema:"name or keyword query"`
	BP    string `json:"bp,omitempty" jsonschema:"body-part filter"`
	EQ    string `json:"eq,omitempty" jsonschema:"equipment filter"`
	Limit *int   `json:"limit,omitzero" jsonschema:"maximum results from 1 to 100"`
}

type MCPBodyweightFilterInput struct {
	D *string `json:"d,omitempty" jsonschema:"optional date in YYYY-MM-DD"`
}

type MCPLogBodyweightInput struct {
	W  float64 `json:"w" jsonschema:"bodyweight in the profile unit, from 20 to 500"`
	D  *string `json:"d,omitempty" jsonschema:"date in YYYY-MM-DD; defaults to today"`
	Tz *string `json:"tz,omitempty" jsonschema:"IANA timezone used when resolving today"`
}

type MCPHistoryInput struct {
	Since      *string `json:"since,omitempty" jsonschema:"inclusive start date in YYYY-MM-DD"`
	Until      *string `json:"until,omitempty" jsonschema:"inclusive end date in YYYY-MM-DD"`
	ExerciseID *string `json:"exerciseId,omitempty" jsonschema:"only workouts containing this exercise id"`
	Limit      *int    `json:"limit,omitzero" jsonschema:"maximum workouts from 1 to 100"`
}

type MCPLimitInput struct {
	Limit *int `json:"limit,omitzero" jsonschema:"maximum results from 1 to 100"`
}

type MCPLogWorkoutInput struct {
	Workout MCPWorkout `json:"workout" jsonschema:"completed workout to append or replace by id"`
}

type MCPTodaySession struct {
	RoutineID string      `json:"routineId"`
	Start     *string     `json:"start,omitempty"`
	Label     *string     `json:"label,omitempty"`
	Routine   *MCPRoutine `json:"routine,omitempty"`
}

type MCPTodayResult struct {
	Iso       string            `json:"iso"`
	Weekday   string            `json:"weekday"`
	Rest      bool              `json:"rest"`
	Override  bool              `json:"override"`
	Sessions  []MCPTodaySession `json:"sessions"`
	WeekSlots []MCPDaySession   `json:"weekSlots,omitempty"`
}

type MCPSearchExercisesOutput struct {
	Exercises []MCPExerciseSearchResult `json:"exercises"`
}

type MCPRoutinesOutput struct {
	Routines []MCPRoutine `json:"routines"`
}

type MCPSetProgramOutput struct {
	OK       bool         `json:"ok"`
	Routines []MCPRoutine `json:"routines"`
	Week     WeekSchedule `json:"week,omitempty"`
	Revision int64        `json:"revision"`
}

type MCPBodyweightOutput struct {
	Unit       string               `json:"unit"`
	Goal       *float64             `json:"goal,omitzero"`
	Bodyweight []MCPBodyweightEntry `json:"bodyweight"`
}

type MCPLogBodyweightOutput struct {
	Unit string   `json:"unit"`
	Goal *float64 `json:"goal,omitzero"`
	OK   bool     `json:"ok"`
	Date string   `json:"date"`
}

type MCPHistoryOutput struct {
	History []MCPHistoryRow `json:"history"`
}

type MCPWorkoutsOutput struct {
	Workouts []MCPWorkout `json:"workouts"`
}

type MCPWorkoutOutput struct {
	OK      bool       `json:"ok"`
	Workout MCPWorkout `json:"workout"`
}

type MCPSuggestionOutput = MCPSuggestion

type MCPDigestExerciseEntry struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Sets       *float64 `json:"sets,omitzero"`
	Reps       *float64 `json:"reps,omitzero"`
	Weight     *float64 `json:"weight,omitzero"`
	Sec        *float64 `json:"sec,omitzero"`
	Min        *float64 `json:"min,omitzero"`
	Speed      *float64 `json:"speed,omitzero"`
	Bodyweight *bool    `json:"bodyweight,omitzero"`
	Side       *bool    `json:"side,omitzero"`
	LastWeight *float64 `json:"lastWeight,omitzero"`
}

type MCPDigestWorkoutEntry struct {
	ID     string       `json:"id"`
	Name   string       `json:"name"`
	Target *MCPExConfig `json:"target,omitempty"`
	Sets   []string     `json:"sets"`
}

type MCPDigestWorkout struct {
	D       string                  `json:"d"`
	Name    string                  `json:"name"`
	BW      *float64                `json:"bw,omitzero"`
	Entries []MCPDigestWorkoutEntry `json:"entries"`
}

type MCPTrainingDigestSession struct {
	RoutineID string                   `json:"routineId"`
	Name      string                   `json:"name"`
	Start     *string                  `json:"start,omitempty"`
	Label     *string                  `json:"label,omitempty"`
	Entries   []MCPDigestExerciseEntry `json:"entries"`
}

type MCPTrainingDigest struct {
	Unit           string                     `json:"unit"`
	Today          string                     `json:"today"`
	BodyweightGoal *float64                   `json:"bodyweightGoal,omitzero"`
	Bodyweight     []MCPBodyweightEntry       `json:"bodyweight"`
	Sessions       []MCPTrainingDigestSession `json:"sessions"`
	LastWorkouts   []MCPDigestWorkout         `json:"lastWorkouts"`
}

type MCPHistoryEntry struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Sets       []string `json:"sets"`
	LastWeight *float64 `json:"lastWeight,omitzero"`
	Hit        *bool    `json:"hit,omitzero"`
}

type MCPHistoryRow struct {
	ID      string            `json:"id"`
	D       string            `json:"d"`
	Name    string            `json:"name"`
	Vol     float64           `json:"vol"`
	Entries []MCPHistoryEntry `json:"entries"`
	PRs     []string          `json:"prs,omitempty"`
	BW      *float64          `json:"bw,omitzero"`
}

type MCPSuggestionEntry struct {
	ID     string   `json:"id" validate:"required,max=200"`
	Sets   *float64 `json:"sets,omitzero" validate:"omitempty,gte=1,lte=12"`
	Reps   *float64 `json:"reps,omitzero" validate:"omitempty,gte=1,lte=500"`
	Weight *float64 `json:"weight,omitzero" validate:"omitempty,gte=0,lte=1000"`
	Sec    *float64 `json:"sec,omitzero" validate:"omitempty,gte=1,lte=7200"`
	Min    *float64 `json:"min,omitzero" validate:"omitempty,gte=1,lte=600"`
	Speed  *float64 `json:"speed,omitzero" validate:"omitempty,gte=0,lte=80"`
	SwapTo *string  `json:"swapTo,omitempty" validate:"omitempty,max=40"`
	Note   *string  `json:"note,omitempty" validate:"omitempty,max=240"`
}

type MCPSuggestion struct {
	Summary string               `json:"summary" validate:"max=800"`
	Entries []MCPSuggestionEntry `json:"entries" validate:"max=30,dive"`
}

type MCPProgramInput struct {
	Routines []MCPRoutineInput `json:"routines" jsonschema:"routines to validate and preview"`
	Week     WeekSchedule      `json:"week,omitempty" jsonschema:"weekday keys 0 through 6 mapped to ordered session lists"`
	Replace  bool              `json:"replace,omitzero" jsonschema:"replace the full program instead of merging routines"`
}

type MCPSetProgramInput struct {
	Routines         []MCPRoutineInput `json:"routines" jsonschema:"routines to validate and apply"`
	Week             WeekSchedule      `json:"week,omitempty" jsonschema:"weekday keys 0 through 6 mapped to ordered session lists"`
	Replace          bool              `json:"replace,omitzero" jsonschema:"replace the full program instead of merging routines"`
	ExpectedRevision *int64            `json:"expectedRevision,omitzero" jsonschema:"revision returned by preview_program for optimistic concurrency"`
}

type MCPPreviewProgramInput = MCPProgramInput

type MCPStrengthProgressInput struct {
	ExerciseID string  `json:"exerciseId" jsonschema:"exercise id to analyze"`
	Formula    *string `json:"formula,omitempty" jsonschema:"one-rep-max formula: epley, brzycki, or lombardi"`
}

type MCPMuscleBalanceInput struct {
	AsOf *string `json:"asOf,omitempty" jsonschema:"analysis end date in YYYY-MM-DD"`
	Days *int    `json:"days,omitzero" jsonschema:"lookback window: 0, 7, 30, or 90 days"`
}

type MCPNextProgressionInput struct {
	ExerciseID string  `json:"exerciseId" jsonschema:"planned exercise id"`
	RoutineID  *string `json:"routineId,omitempty" jsonschema:"routine id required when the exercise appears in multiple routines"`
}

type MCPLogExerciseSet struct {
	W    *float64 `json:"w,omitzero" jsonschema:"performed weight in the profile unit"`
	R    float64  `json:"r" jsonschema:"performed repetitions"`
	Done *bool    `json:"done,omitzero" jsonschema:"whether the set was completed; defaults to true"`
}

type MCPLogExerciseSetsInput struct {
	WorkoutID  *string             `json:"workoutId,omitempty" jsonschema:"optional workout id up to 40 characters; reuse to update that workout, or supply a new id for a separate session of the same routine on the same date"`
	ExerciseID string              `json:"exerciseId" jsonschema:"exercise catalog id"`
	D          *string             `json:"d,omitempty" jsonschema:"date in YYYY-MM-DD; defaults to today"`
	Tz         *string             `json:"tz,omitempty" jsonschema:"IANA timezone used when resolving today"`
	RoutineID  *string             `json:"routineId,omitempty" jsonschema:"source routine id; inferred when the exercise is in exactly one routine"`
	Sets       []MCPLogExerciseSet `json:"sets" jsonschema:"working sets; omit warm-ups"`
}

type MCPLogExerciseSetsOutput struct {
	OK       bool           `json:"ok"`
	Workout  MCPWorkout     `json:"workout"`
	Next     MCPProgression `json:"next"`
	Revision int64          `json:"revision"`
}

type MCPLastPerformance struct {
	Date   string   `json:"date"`
	Sets   []string `json:"sets"`
	Weight float64  `json:"weight"`
	Hit    bool     `json:"hit"`
}

type MCPNextTarget struct {
	Sets   *float64 `json:"sets,omitzero"`
	Reps   *float64 `json:"reps,omitzero"`
	Weight *float64 `json:"weight,omitzero"`
	Sec    *float64 `json:"sec,omitzero"`
}

type MCPExercisePrescription struct {
	ID       string              `json:"id"`
	Name     string              `json:"name"`
	Last     *MCPLastPerformance `json:"last,omitempty"`
	Next     MCPNextTarget       `json:"next"`
	Decision string              `json:"decision"`
	Reason   string              `json:"reason"`
}

type MCPSessionPrescription struct {
	RoutineID   string                    `json:"routineId"`
	RoutineName string                    `json:"routineName"`
	Start       *string                   `json:"start,omitempty"`
	Label       *string                   `json:"label,omitempty"`
	Policy      *string                   `json:"policy,omitempty"`
	Exercises   []MCPExercisePrescription `json:"exercises"`
}

type MCPDayPrescription struct {
	Iso      string                   `json:"iso"`
	Unit     string                   `json:"unit"`
	Rest     bool                     `json:"rest"`
	Sessions []MCPSessionPrescription `json:"sessions"`
}

type MCPProgramState struct {
	Routines []MCPRoutine `json:"routines"`
	Week     WeekSchedule `json:"week,omitempty"`
}

type MCPAddDaySessionInput struct {
	Iso              string  `json:"iso" jsonschema:"date in YYYY-MM-DD"`
	RoutineID        string  `json:"routineId" jsonschema:"routine id to append as a session"`
	Start            *string `json:"start,omitempty" jsonschema:"optional local start time HH:MM"`
	Label            *string `json:"label,omitempty" jsonschema:"optional coach-facing label"`
	ExpectedRevision *int64  `json:"expectedRevision,omitzero" jsonschema:"optional revision for optimistic concurrency"`
}

type MCPRemoveDaySessionInput struct {
	Iso              string `json:"iso" jsonschema:"date in YYYY-MM-DD"`
	RoutineID        string `json:"routineId" jsonschema:"routine id to remove from that date"`
	Index            *int   `json:"index,omitzero" jsonschema:"optional 0-based session index when the same routine appears twice"`
	ExpectedRevision *int64 `json:"expectedRevision,omitzero" jsonschema:"optional revision for optimistic concurrency"`
}

type MCPDaySessionsOutput struct {
	OK       bool            `json:"ok"`
	Iso      string          `json:"iso"`
	Rest     bool            `json:"rest"`
	Sessions []MCPDaySession `json:"sessions"`
	Revision int64           `json:"revision"`
}

type MCPRoutineChange struct {
	ID      string     `json:"id"`
	Routine MCPRoutine `json:"routine"`
}

type MCPRoutineUpdate struct {
	ID     string      `json:"id"`
	Before *MCPRoutine `json:"before,omitempty"`
	After  *MCPRoutine `json:"after,omitempty"`
}

type MCPScheduleChange struct {
	Day    string          `json:"day"`
	Before []MCPDaySession `json:"before,omitempty"`
	After  []MCPDaySession `json:"after,omitempty"`
}

type MCPProgramDiff struct {
	AddedRoutines   []MCPRoutineChange  `json:"addedRoutines"`
	UpdatedRoutines []MCPRoutineUpdate  `json:"updatedRoutines"`
	RemovedRoutines []MCPRoutineChange  `json:"removedRoutines"`
	ScheduleChanges []MCPScheduleChange `json:"scheduleChanges"`
	Summary         string              `json:"summary"`
}

type MCPProgramPreview struct {
	OK              bool            `json:"ok"`
	Replace         *bool           `json:"replace,omitzero"`
	Revision        *int64          `json:"revision,omitzero"`
	CurrentRevision *int64          `json:"currentRevision,omitzero"`
	Sanitized       MCPProgramInput `json:"sanitized"`
	Proposed        MCPProgramState `json:"proposed"`
	Result          MCPProgramState `json:"result"`
	Diff            MCPProgramDiff  `json:"diff"`
}

type MCPStrengthPoint struct {
	D string  `json:"d"`
	T int64   `json:"t"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	R float64 `json:"r"`
}

type MCPBestStrength struct {
	Est float64 `json:"est"`
	W   float64 `json:"w"`
	R   float64 `json:"r"`
	D   string  `json:"d"`
	T   int64   `json:"t"`
}

type MCPStrengthProgress struct {
	ExerciseID string             `json:"exerciseId"`
	Formula    string             `json:"formula"`
	Trend      []MCPStrengthPoint `json:"trend"`
	Best       *MCPBestStrength   `json:"best,omitempty"`
	Reason     *string            `json:"reason,omitempty"`
}

type MCPMuscleLoadView struct {
	Load      map[string]float64 `json:"load"`
	Levels    map[string]int     `json:"levels"`
	Worked    []string           `json:"worked"`
	Missed    []string           `json:"missed"`
	Available *bool              `json:"available,omitzero"`
}

type MCPMuscleBalance struct {
	AsOf     string            `json:"asOf"`
	Days     int               `json:"days"`
	Rated    bool              `json:"rated"`
	HardSets int               `json:"hardSets"`
	All      MCPMuscleLoadView `json:"all"`
	Hard     MCPMuscleLoadView `json:"hard"`
}

type MCPProgression struct {
	Policy string   `json:"policy"`
	Kind   string   `json:"kind"`
	Weight *float64 `json:"weight,omitzero"`
	Reps   *float64 `json:"reps,omitzero"`
	Sec    *float64 `json:"sec,omitzero"`
	Sets   *float64 `json:"sets,omitzero"`
	Reason *string  `json:"reason,omitempty"`
}
