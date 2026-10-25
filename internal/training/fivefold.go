package training

import "math"

// The native and web clients share the TypeScript implementation. This adapter
// preserves its saved-state semantics for the Go/MCP training interface.
func advanceFivefoldConfig(cfg MCPExConfig, entry MCPWorkoutEntry, workoutID, unit string) MCPExConfig {
	if cfg.Fivefold != nil && cfg.Fivefold.LastWorkoutID == workoutID {
		return cfg
	}
	state := FivefoldPolicyState{Bar: 45, AutoProgress: true, AutoDeload: true}
	if unit == "kg" {
		state.Bar = 20
	}
	if cfg.Fivefold != nil {
		state = *cfg.Fivefold
	}
	policyUnit := state.Unit
	if policyUnit == "" {
		policyUnit = unit
	}
	increment := floatPointerValue(cfg.Inc)
	if increment <= 0 {
		increment = 5
		if policyUnit == "kg" {
			increment = 2.5
		}
	} else {
		increment = math.Round(convertPolicyLoad(increment, unit, policyUnit)*1000) / 1000
	}
	weight := math.Round(convertPolicyLoad(sessionWorkingWeight(entry, progressionConfigFromMCP(cfg)), unit, policyUnit)*1000) / 1000
	sets := workingSets(entry.Sets)
	count := int(floatPointerValue(cfg.Sets))
	if count < 1 {
		count = len(sets)
	}
	success, complete := count > 0, count > 0
	for i := range count {
		if i >= len(sets) || !sets[i].Done {
			success = false
			complete = false
			continue
		}
		if floatPointerValue(sets[i].R) != 5 {
			success = false
		}
	}
	if success && count > 0 {
		if state.AutoProgress {
			weight += increment
		}
		state.Failures = 0
	} else if complete {
		state.Failures = min(10000, state.Failures+1)
		if state.Failures >= 3 && state.AutoDeload {
			weight = max(state.Bar, math.Floor((weight*.9+1e-9)/increment)*increment)
			state.Failures = 0
		}
	}
	limit := 4410.0
	if policyUnit == "kg" {
		limit = 2000
	}
	weight = math.Round(min(limit, weight)*1000) / 1000
	state.LastWorkoutID = workoutID
	cfg.Weight = new(convertPolicyLoad(weight, policyUnit, unit))
	cfg.Fivefold = &state
	return cfg
}

func convertPolicyLoad(value float64, from, to string) float64 {
	if from == to {
		return value
	}
	if from == "lb" {
		return value * .45359237
	}
	return value / .45359237
}
