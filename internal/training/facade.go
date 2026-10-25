package training

import (
	"encoding/json/jsontext"
	"github.com/aranlucas/set-and-signal-unified/internal/validation"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/exercises"
)

// HistoryQuery is the transport-neutral filter for completed workouts.
type HistoryQuery struct {
	Since      string
	Until      string
	ExerciseID string
	Limit      int
}

func TodayISO(timezone string, now time.Time) string {
	return todayISOLocal(timezone, now)
}

func ValidISODate(value string) bool {
	return validation.Validator.Var(value, "datetime=2006-01-02") == nil
}

func Day(data TrainingData, iso string) MCPTodayResult {
	return trainingDay(data, iso)
}

func SearchExercises(data TrainingData, query string, filters exercises.SearchFilters) []MCPExerciseSearchResult {
	return searchExercises(data, query, filters)
}

func BuildDigest(data TrainingData, sessions []MCPDaySession, today string) MCPTrainingDigest {
	return buildTrainingDigest(data, sessions, today)
}

func BuildHistory(data TrainingData, query HistoryQuery) []MCPHistoryRow {
	return buildHistory(data, query)
}

func SessionPrescription(data TrainingData, iso string) MCPDayPrescription {
	return sessionPrescription(data, iso)
}

func NormalizeDaySession(session MCPDaySession) (MCPDaySession, error) {
	return normalizeDaySession(session)
}

func CloneWeekSchedule(week WeekSchedule) WeekSchedule {
	return cloneWeekSchedule(week)
}

func CloneDaySessions(sessions []MCPDaySession) []MCPDaySession {
	return cloneDaySessions(sessions)
}

func DaySessionsEqual(a, b []MCPDaySession) bool {
	return daySessionsEqual(a, b)
}

func AddSessionToDayPlan(data *TrainingData, iso string, session MCPDaySession) error {
	return addSessionToDayPlan(data, iso, session)
}

func RemoveSessionFromDayPlan(data *TrainingData, iso, routineID string, index *int) error {
	return removeSessionFromDayPlan(data, iso, routineID, index)
}

func ResolveDaySessions(data TrainingData, iso string) (sessions []MCPDaySession, override, rest bool) {
	return resolveDaySessions(data, iso)
}

// DecodeWeekMap decodes the current typed schedule map.
func DecodeWeekMap(value jsontext.Value) (WeekSchedule, error) {
	return decodeWeekMap(value)
}

// DecodeDayPlanMap decodes current typed day overrides.
func DecodeDayPlanMap(value jsontext.Value) (DayPlanMap, error) {
	return decodeDayPlanMap(value)
}

func LogExerciseSets(data *TrainingData, input MCPLogExerciseSetsInput, now time.Time) (MCPWorkout, MCPProgression, error) {
	return logExerciseSets(data, input, now)
}
