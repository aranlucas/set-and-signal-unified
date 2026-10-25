package training

// Deterministic training analytics used by MCP. These functions operate on
// the closed TrainingData graph loaded by TrainingDataRepository.

import (
	"cmp"
	"maps"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/exercises"
)

const analyticsRepCap = 12

// Estimate1RM applies the same estimators as web/src/domain/training/onerm.ts. The bool
// is false when an estimate would be misleading (including warm-up/timed sets,
// which are rejected by callers before reaching this function).
func Estimate1RM(weight, reps float64, formula string) (float64, bool) {
	if !isFinite(weight) || !isFinite(reps) || weight <= 0 || reps < 1 || reps > analyticsRepCap {
		return 0, false
	}
	formula = strings.ToLower(strings.TrimSpace(formula))
	if reps == 1 {
		return roundTenth(weight), true
	}
	r := math.Round(reps)
	var estimate float64
	switch formula {
	case "brzycki":
		estimate = weight * 36 / (37 - r)
	case "lombardi":
		estimate = weight * math.Pow(r, 0.1)
	default: // epley, and unknown formulas, match the frontend fallback.
		estimate = weight * (1 + r/30)
	}
	if !isFinite(estimate) || estimate <= 0 {
		return 0, false
	}
	return roundTenth(estimate), true
}

type e1rmSet struct {
	est, weight, reps float64
}

type e1rmPoint struct {
	Date     string
	Start    int64
	Estimate float64
	Weight   float64
	Reps     float64
}

// StrengthProgress is the MCP-friendly aggregate for one exercise.  reason is
// present whenever there is no best estimate so a client can explain the gap
// instead of returning an empty chart without context.
func StrengthProgress(st TrainingData, exerciseID, formula string) MCPStrengthProgress {
	if strings.TrimSpace(formula) == "" {
		formula = "epley"
	}
	points := collectE1RM(st, exerciseID, formula)
	out := MCPStrengthProgress{ExerciseID: exerciseID, Formula: strings.ToLower(formula), Trend: make([]MCPStrengthPoint, 0, len(points))}
	for _, point := range points {
		out.Trend = append(out.Trend, MCPStrengthPoint{D: point.Date, T: point.Start, Y: point.Estimate, W: point.Weight, R: math.Round(point.Reps)})
	}
	if len(points) > 0 {
		best := points[0]
		for _, point := range points[1:] {
			if point.Estimate > best.Estimate {
				best = point
			}
		}
		out.Best = &MCPBestStrength{Est: best.Estimate, W: best.Weight, R: math.Round(best.Reps), D: best.Date, T: best.Start}
		return out
	}
	out.Reason = new(noEstimateReason(st, exerciseID))
	return out
}

func noEstimateReason(st TrainingData, exerciseID string) string {
	found := false
	done := 0
	warmups := 0
	tooMany := 0
	for _, workout := range st.Workouts {
		for _, entry := range workout.Entries {
			if entry.ID != exerciseID {
				continue
			}
			for _, set := range entry.Sets {
				if !set.Done {
					continue
				}
				found = true
				if set.WU != nil && *set.WU {
					warmups++
					continue
				}
				done++
				if set.R != nil && *set.R > analyticsRepCap {
					tooMany++
				}
			}
		}
	}
	if !found {
		return "No completed sets for this exercise yet."
	}
	if done == 0 {
		return "Only warm-up sets are logged; complete a working set to estimate strength."
	}
	if tooMany == done {
		return "All completed working sets exceed the 12-rep estimate cap."
	}
	return "No completed working set has both a positive weight and 1–12 reps."
}

func collectE1RM(st TrainingData, exerciseID, formula string) []e1rmPoint {
	type workoutPoint struct {
		point e1rmPoint
		idx   int
	}
	rows := make([]workoutPoint, 0)
	for idx, workout := range st.Workouts {
		best, ok := bestSet(workout, exerciseID, formula)
		if !ok {
			continue
		}
		rows = append(rows, workoutPoint{point: e1rmPoint{
			Date: workout.D, Start: workout.Start,
			Estimate: best.est, Weight: best.weight, Reps: math.Round(best.reps),
		}, idx: idx})
	}
	// The web app normally stores append order, but sorting makes imported or
	// merged state deterministic without changing ties on the same timestamp.
	slices.SortFunc(rows, func(a, b workoutPoint) int {
		if byDate := cmp.Compare(a.point.Date, b.point.Date); byDate != 0 {
			return byDate
		}
		if byStart := cmp.Compare(a.point.Start, b.point.Start); byStart != 0 {
			return byStart
		}
		return cmp.Compare(a.idx, b.idx)
	})
	out := make([]e1rmPoint, len(rows))
	for i := range rows {
		out[i] = rows[i].point
	}
	return out
}

func bestSet(workout MCPWorkout, exerciseID, formula string) (e1rmSet, bool) {
	for _, entry := range workout.Entries {
		if entry.ID != exerciseID {
			continue
		}
		var best e1rmSet
		found := false
		for _, set := range entry.Sets {
			if !set.Done || (set.WU != nil && *set.WU) {
				continue
			}
			if set.W == nil || set.R == nil {
				continue
			}
			weight, reps := *set.W, *set.R
			est, ok := Estimate1RM(weight, reps, formula)
			if ok && (!found || est > best.est) {
				best = e1rmSet{est: est, weight: weight, reps: reps}
				found = true
			}
		}
		return best, found
	}
	return e1rmSet{}, false
}

// MuscleBalance calculates effective sets per muscle. days is 0 for all
// history; 7 follows the UI's calendar-week semantics, while 30/90 are
// rolling date windows ending at asOf.  The result includes both all-set and
// hard-set views when effort ratings are available.
func MuscleBalance(st TrainingData, asOf string, days int) MCPMuscleBalance {
	if asOf == "" {
		asOf = time.Now().UTC().Format("2006-01-02")
	}
	all, hard, rated, hardCount := muscleLoads(st, asOf, days)
	return muscleBalanceResult(days, asOf, all, hard, rated, hardCount)
}

var analyticsMuscles = []string{
	"trapezius", "deltoids", "chest", "upper-back", "serratus", "biceps", "triceps", "forearm",
	"abs", "obliques", "lower-back", "gluteal", "quadriceps", "hamstring", "adductors",
	"hip-flexors", "calves", "tibialis",
}

var analyticsAliases = map[string]string{
	"abs": "abs", "pectorals": "chest", "biceps": "biceps", "glutes": "gluteal", "delts": "deltoids",
	"triceps": "triceps", "upper back": "upper-back", "lats": "upper-back", "calves": "calves",
	"quads": "quadriceps", "forearms": "forearm", "hamstrings": "hamstring", "spine": "lower-back",
	"traps": "trapezius", "adductors": "adductors", "serratus anterior": "serratus", "abductors": "gluteal",
	"levator scapulae": "trapezius", "shoulders": "deltoids", "deltoids": "deltoids", "rear deltoids": "deltoids",
	"rotator cuff": "deltoids", "quadriceps": "quadriceps", "core": "abs", "abdominals": "abs", "lower abs": "abs",
	"chest": "chest", "upper chest": "chest", "hip flexors": "hip-flexors", "obliques": "obliques",
	"lower back": "lower-back", "rhomboids": "upper-back", "trapezius": "trapezius", "back": "upper-back",
	"latissimus dorsi": "upper-back", "brachialis": "biceps", "soleus": "calves", "shins": "tibialis",
	"wrists": "forearm", "wrist flexors": "forearm", "wrist extensors": "forearm", "grip muscles": "forearm",
	"groin": "adductors", "inner thighs": "adductors",
}

var analyticsBodyParts = map[string]map[string]float64{
	"chest": {"chest": 1}, "back": {"upper-back": .75, "lower-back": .25}, "shoulders": {"deltoids": 1},
	"upper arms": {"biceps": .5, "triceps": .5}, "lower arms": {"forearm": 1}, "waist": {"abs": .7, "obliques": .3},
	"upper legs": {"quadriceps": .4, "hamstring": .35, "gluteal": .25}, "lower legs": {"calves": .8, "tibialis": .2},
	"neck": {"trapezius": 1},
}

func muscleLoads(st TrainingData, asOf string, days int) (map[string]float64, map[string]float64, bool, int) {
	all, hard := make(map[string]float64, len(analyticsMuscles)), make(map[string]float64, len(analyticsMuscles))
	rated, hardCount := false, 0
	for _, workout := range st.Workouts {
		if !workoutInWindow(workout, asOf, days) {
			continue
		}
		for _, entry := range workout.Entries {
			metadata := analyticsExercise(entry.ID, st.CustomEx)
			weights := analyticsMusclesOf(metadata)
			if len(weights) == 0 {
				continue
			}
			for _, set := range entry.Sets {
				if !set.Done || (set.WU != nil && *set.WU) {
					continue
				}
				for muscle, weight := range weights {
					all[muscle] += weight
				}
				rating, ok := effortRIR(set)
				if !ok {
					continue
				}
				rated = true
				if rating <= 3 {
					hardCount++
					for muscle, weight := range weights {
						hard[muscle] += weight
					}
				}
			}
		}
	}
	return all, hard, rated, hardCount
}

func muscleBalanceResult(days int, asOf string, all, hard map[string]float64, rated bool, hardCount int) MCPMuscleBalance {
	levels := func(load map[string]float64) map[string]int {
		max := 0.0
		for _, muscle := range analyticsMuscles {
			if load[muscle] > max {
				max = load[muscle]
			}
		}
		out := make(map[string]int, len(analyticsMuscles))
		for _, muscle := range analyticsMuscles {
			v := load[muscle]
			level := 0
			if v > 0 && max > 0 {
				level = min(4, int(math.Ceil(v/max*4)))
				if level < 1 {
					level = 1
				}
			}
			out[muscle] = level
		}
		return out
	}
	rank := func(load map[string]float64) (worked, missed []string) {
		worked = make([]string, 0, len(analyticsMuscles))
		for _, muscle := range analyticsMuscles {
			if load[muscle] > 0 {
				worked = append(worked, muscle)
			} else {
				missed = append(missed, muscle)
			}
		}
		slices.SortStableFunc(worked, func(a, b string) int { return cmp.Compare(load[b], load[a]) })
		return worked, missed
	}
	worked, missed := rank(all)
	hardWorked, hardMissed := rank(hard)
	loads := func(src map[string]float64) map[string]float64 {
		out := make(map[string]float64, len(analyticsMuscles))
		for _, m := range analyticsMuscles {
			out[m] = roundTenth(src[m])
		}
		return out
	}
	return MCPMuscleBalance{
		AsOf: asOf, Days: days, Rated: rated, HardSets: hardCount,
		All:  MCPMuscleLoadView{Load: loads(all), Levels: levels(all), Worked: worked, Missed: missed},
		Hard: MCPMuscleLoadView{Load: loads(hard), Levels: levels(hard), Worked: hardWorked, Missed: hardMissed, Available: new(rated && hardCount > 0)},
	}
}

func analyticsExercise(id string, custom []MCPCustomExercise) exercises.Exercise {
	for _, exercise := range custom {
		if exercise.ID == id {
			return exercises.Exercise{ID: id, N: exercise.N, BP: exercise.BP, EQ: exercise.EQ, TG: exercise.TG}
		}
	}
	if e, ok := exercises.Lookup(id); ok {
		return e
	}
	return exercises.Exercise{}
}

func analyticsMusclesOf(ex exercises.Exercise) map[string]float64 {
	load := make(map[string]float64)
	add := func(name string, weight float64) {
		if slug, ok := analyticsAliases[strings.ToLower(strings.TrimSpace(name))]; ok {
			if load[slug] < weight {
				load[slug] = weight
			}
		}
	}
	add(ex.TG, 1)
	for _, secondary := range ex.SM {
		add(secondary, .4)
	}
	if len(load) == 0 {
		maps.Copy(load, analyticsBodyParts[strings.ToLower(strings.TrimSpace(ex.BP))])
	}
	return load
}

func effortRIR(set MCPLoggedSet) (float64, bool) {
	if set.RIR != nil {
		return *set.RIR, true
	}
	if set.RPE != nil {
		return 10 - *set.RPE, true
	}
	return 0, false
}

func workoutInWindow(workout MCPWorkout, asOf string, days int) bool {
	if days == 0 {
		return true
	}
	d := workout.D
	if d == "" {
		return false
	}
	if days == 7 {
		date, err := time.Parse("2006-01-02", asOf)
		if err != nil {
			return false
		}
		start := date.AddDate(0, 0, -int(date.Weekday()))
		value, err := time.Parse("2006-01-02", d)
		return err == nil && !value.Before(start) && !value.After(date)
	}
	date, err := time.Parse("2006-01-02", d)
	if err != nil {
		return false
	}
	end, err := time.Parse("2006-01-02", asOf)
	if err != nil {
		return false
	}
	cutoff := end.AddDate(0, 0, -days)
	return date.After(cutoff) && !date.After(end)
}

// NextProgression ports the policy decision in web/src/domain/training/progression.ts.
// It is intentionally a pure read: no counters or prescriptions are persisted.
func NextProgression(st TrainingData, cfg MCPExConfig, routine MCPRoutine) MCPProgression {
	if stringPointerValue(cfg.Prog) == "fivefold" || stringPointerValue(routine.Prog) == "fivefold" {
		out := progressionResult("fivefold", "hold", "Saved 5×5 target; skipped sets do not add misses.")
		out.Weight = cloneFloat(cfg.Weight)
		return out
	}
	return nextProgressionTyped(st, progressionConfigFromMCP(cfg), stringPointerValue(routine.Prog))
}

type progressionConfig struct {
	id, mode, prog          string
	sets, reps, weight, sec float64
	inc, repsMin, repsMax   float64
	side, bodyweight        bool
}

func progressionConfigFromMCP(cfg MCPExConfig) progressionConfig {
	return progressionConfig{
		id: cfg.ID, mode: stringPointerValue(cfg.Mode), prog: stringPointerValue(cfg.Prog),
		sets: floatPointerValue(cfg.Sets), reps: floatPointerValue(cfg.Reps), weight: floatPointerValue(cfg.Weight),
		sec: floatPointerValue(cfg.Sec), inc: floatPointerValue(cfg.Inc), repsMin: floatPointerValue(cfg.RepsMin),
		repsMax: floatPointerValue(cfg.RepsMax), side: boolPointerValue(cfg.Side),
		bodyweight: boolPointerValue(cfg.Bodyweight),
	}
}

func stringPointerValue(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func floatPointerValue(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}
func boolPointerValue(v *bool) bool { return v != nil && *v }

func progressionResult(policy, kind, reason string) MCPProgression {
	out := MCPProgression{Policy: policy, Kind: kind}
	if reason != "" {
		out.Reason = new(reason)
	}
	return out
}

func nextProgressionTyped(st TrainingData, cfg progressionConfig, routinePolicy string) MCPProgression {
	id := cfg.id
	mode := progressionMode(cfg)
	policy := cfg.prog
	if policy == "" {
		policy = routinePolicy
	}
	if policy == "" && mode == "reps" {
		policy = "linear"
	}
	if !validPolicy(mode, policy) {
		policy = "off"
	}
	if policy == "off" {
		return progressionResult(policy, "off", "")
	}
	unit := st.Unit
	if unit == "" {
		unit = "lb"
	}
	step := cfg.inc
	if step <= 0 {
		if mode == "time" {
			step = 5
		} else {
			step = defaultAnalyticsIncrement(id, unit)
		}
	}
	sessions := progressionSessions(st, id, cfg)
	if len(sessions) == 0 {
		return progressionResult(policy, "first", "Nothing logged yet — this session sets the baseline.")
	}
	last := sessions[len(sessions)-1]
	stalls := 0
	for i := len(sessions) - 1; i >= 0 && !sessions[i].ok; i-- {
		stalls++
	}
	deloadAfter := map[string]int{"linear": 2, "greyskull": 1, "double": 3, "time": 3}[policy]
	if deloadAfter == 0 {
		deloadAfter = 3
	}
	if mode == "time" {
		if last.ok {
			out := progressionResult(policy, "up", "Held every set for the full time — target up.")
			out.Sec = new(last.goal + step)
			return out
		}
		if stalls >= deloadAfter {
			out := progressionResult(policy, "deload", "Repeated short sessions — back off and build up again.")
			out.Sec = new(analyticsDeload(last.goal, 5))
			return out
		}
		out := progressionResult(policy, "hold", "Last time came up short — same target again.")
		out.Sec = new(last.goal)
		return out
	}
	if last.weight <= 0 && isBodyweightConfig(cfg) {
		goal := last.goal
		if !last.ok || goal <= 0 {
			out := progressionResult(policy, "hold", "Bodyweight — same target again until every set is clean.")
			out.Weight, out.Reps = new(0.0), new(goal)
			return out
		}
		if top := cfg.repsMax; top > 0 && goal >= top {
			sets := max(1, cfg.sets)
			if sets < float64(last.count) {
				sets = float64(last.count)
			}
			sets++
			bottom := max(1, min(cfg.reps, top))
			if bottom == 1 && cfg.reps == 0 {
				bottom = top
			}
			if sets <= 6 {
				out := progressionResult(policy, "up", "Top of the rep range — add a set and reset reps.")
				out.Weight, out.Reps, out.Sets = new(0.0), new(bottom), new(sets)
				return out
			}
		}
		out := progressionResult(policy, "up", "Bodyweight — every rep last time, so add a rep.")
		out.Weight, out.Reps = new(0.0), new(goal+analyticsRepStep(cfg))
		return out
	}
	if last.weight <= 0 {
		goal := last.goal
		if goal == 0 {
			goal = cfg.reps
		}
		out := progressionResult(policy, "hold", "Nothing logged yet — this session sets the baseline.")
		out.Weight, out.Reps = new(0.0), new(goal)
		return out
	}
	if policy == "double" {
		top := cfg.reps
		if top == 0 {
			top = last.goal
		}
		if top == 0 {
			top = 10
		}
		bottom := cfg.repsMin
		if bottom == 0 {
			bottom = max(1, top-2)
		}
		if bottom > top {
			bottom = top
		}
		if last.ok {
			out := progressionResult(policy, "up", "Top of the rep range in every set — add weight.")
			out.Weight, out.Reps = new(analyticsSnap(last.weight+step, step)), new(bottom)
			return out
		}
		if stalls >= deloadAfter {
			out := progressionResult(policy, "deload", "Stalled sessions — deload and work back up.")
			out.Weight, out.Reps = new(analyticsDeload(last.weight, step)), new(bottom)
			return out
		}
		aim := min(top, max(bottom, last.low+analyticsRepStep(cfg)))
		out := progressionResult(policy, "hold", "Same weight — aim for more reps this time.")
		out.Weight, out.Reps = new(last.weight), new(aim)
		return out
	}
	if last.ok {
		jump := step
		if policy == "greyskull" && last.goal > 0 && last.amrap >= last.goal*2 {
			jump *= 2
		}
		out := progressionResult(policy, "up", "Every rep last time — add weight.")
		out.Weight = new(analyticsSnap(last.weight+jump, step))
		return out
	}
	if stalls >= deloadAfter {
		out := progressionResult(policy, "deload", "Missed reps repeatedly — reset and work back up.")
		out.Weight = new(analyticsDeload(last.weight, step))
		return out
	}
	out := progressionResult(policy, "hold", "Missed reps last time — same weight again.")
	out.Weight = new(last.weight)
	return out
}

type progressionSession struct {
	mode                     string
	goal, weight, low, amrap float64
	count                    int
	ok                       bool
}

func progressionSessions(st TrainingData, id string, cfg progressionConfig) []progressionSession {
	var out []progressionSession
	for _, workout := range st.Workouts {
		for _, entry := range workout.Entries {
			if entry.ID != id {
				continue
			}
			sets := entry.Sets
			hasDone := false
			for _, set := range sets {
				if set.Done {
					hasDone = true
					break
				}
			}
			if !hasDone {
				continue
			}
			target := cfg
			if entry.Target != nil {
				target = progressionConfigFromMCP(*entry.Target)
			}
			mode := progressionMode(target)
			working := workingSets(sets)
			planned := target.sets
			if planned == 0 {
				planned = float64(len(working))
			}
			enough := float64(len(working)) >= planned
			weight := sessionWorkingWeight(entry, cfg)
			if mode == "time" {
				goal := target.sec
				held := make([]float64, len(working))
				for i, set := range working {
					if set.Done && set.Sec != nil {
						held[i] = *set.Sec
					}
				}
				ok := goal > 0 && enough && len(held) > 0
				for _, v := range held {
					if v < goal {
						ok = false
					}
				}
				out = append(out, progressionSession{mode: mode, goal: goal, weight: weight, ok: ok, count: len(working)})
				continue
			}
			goal := target.reps
			reps := make([]float64, len(working))
			low, amrap := math.MaxFloat64, 0.0
			for i, set := range working {
				if set.Done && set.R != nil {
					reps[i] = *set.R
				}
				if reps[i] < low {
					low = reps[i]
				}
			}
			if len(reps) > 0 {
				amrap = reps[len(reps)-1]
			}
			ok := goal > 0 && enough && len(reps) > 0
			for _, v := range reps {
				if v < goal {
					ok = false
				}
			}
			if low == math.MaxFloat64 {
				low = 0
			}
			out = append(out, progressionSession{mode: mode, goal: goal, weight: weight, low: low, amrap: amrap, count: len(working), ok: ok})
		}
	}
	return out
}

func progressionMode(cfg progressionConfig) string {
	if mode := cfg.mode; mode == "time" || mode == "cardio" || mode == "reps" {
		return mode
	}
	if e, ok := exercises.Lookup(cfg.id); ok && e.BP == "cardio" {
		return "cardio"
	}
	return "reps"
}

func validPolicy(mode, policy string) bool {
	if mode == "cardio" {
		return policy == "off"
	}
	if mode == "time" {
		return policy == "off" || policy == "time"
	}
	return policy == "off" || policy == "linear" || policy == "greyskull" || policy == "double" || policy == "fivefold"
}

func defaultAnalyticsIncrement(id, unit string) float64 {
	e, _ := exercises.Lookup(id)
	eq := strings.ToLower(strings.TrimSpace(e.EQ))
	compact := eq == "dumbbell" || eq == "kettlebell"
	heavy := e.BP == "upper legs" || e.BP == "lower legs" || e.BP == "back" || e.BP == "hips" || e.BP == "glutes"
	if compact {
		if unit == "lb" {
			return 5
		}
		return 2.5
	}
	if unit == "lb" {
		if heavy {
			return 10
		}
		return 5
	}
	if heavy {
		return 5
	}
	return 2.5
}

func analyticsRepStep(cfg progressionConfig) float64 {
	if cfg.side {
		return 2
	}
	return 1
}

func analyticsSnap(v, step float64) float64 {
	if step <= 0 {
		return roundTenth(v)
	}
	return roundTenth(math.Round(v/step) * step)
}

func analyticsDeload(v, step float64) float64 {
	out := analyticsSnap(v*.9, step)
	if out >= v {
		out = analyticsSnap(v-step, step)
	}
	if out < step {
		out = step
	}
	return out
}

func isFinite(v float64) bool      { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func roundTenth(v float64) float64 { return math.Round(v*10) / 10 }

func workingSets(sets []MCPLoggedSet) []MCPLoggedSet {
	out := make([]MCPLoggedSet, 0, len(sets))
	for _, set := range sets {
		if set.WU == nil || !*set.WU {
			out = append(out, set)
		}
	}
	return out
}

func sessionWorkingWeight(entry MCPWorkoutEntry, fallback progressionConfig) float64 {
	weight := 0.0
	for _, set := range workingSets(entry.Sets) {
		if set.Done && set.W != nil && *set.W > weight {
			weight = *set.W
		}
	}
	if weight > 0 {
		return weight
	}
	if entry.TopW != nil && *entry.TopW > 0 {
		return *entry.TopW
	}
	target := fallback
	if entry.Target != nil {
		target = progressionConfigFromMCP(*entry.Target)
	}
	if target.weight > 0 {
		return target.weight
	}
	return 0
}

func isBodyweightConfig(cfg progressionConfig) bool {
	if cfg.bodyweight {
		return true
	}
	e, ok := exercises.Lookup(cfg.id)
	return ok && e.EQ == "body weight"
}

func isLoadedRepsExercise(cfg MCPExConfig) bool {
	pc := progressionConfigFromMCP(cfg)
	mode := progressionMode(pc)
	if mode == "time" || mode == "cardio" {
		return false
	}
	return !isBodyweightConfig(pc)
}
