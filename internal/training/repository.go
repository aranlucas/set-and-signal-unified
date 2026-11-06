package training

import (
	"cmp"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"strings"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/store"
	"github.com/aranlucas/set-and-signal-unified/internal/validation"
)

var ErrTrainingDataRevisionConflict = errors.New("training data revision conflict")

// RevisionConflictError reports an optimistic-concurrency failure. Actual is
// zero when the user has no stored document or the document has no _ts field.
type RevisionConflictError struct {
	Expected int64
	Actual   int64
}

func (e *RevisionConflictError) Error() string {
	return fmt.Sprintf("%v: expected %d, actual %d", ErrTrainingDataRevisionConflict, e.Expected, e.Actual)
}

func (e *RevisionConflictError) Is(target error) bool {
	return target == ErrTrainingDataRevisionConflict
}

// TrainingDataRepository owns the training JSON document. It exposes typed
// training data and one atomic mutation primitive; callers do not need to know about SQL, JSON
// encoding, or how unrelated application fields are stored.
type TrainingDataRepository struct {
	st *store.Store
}

func NewTrainingDataRepository(st *store.Store) *TrainingDataRepository {
	if st == nil {
		return nil
	}
	return &TrainingDataRepository{st: st}
}

// Load returns the normalized training-data view. Unknown top-level fields
// are intentionally not returned because they belong to other product
// surfaces, but they remain intact across Mutate calls.
func (r *TrainingDataRepository) Load(uid string) (TrainingData, error) {
	if r == nil || r.st == nil {
		return TrainingData{}, errors.New("training data repository is nil")
	}
	raw, err := r.st.ReadState(uid)
	if err != nil {
		return TrainingData{}, fmt.Errorf("load training data: %w", err)
	}
	data, err := decodeTrainingData(raw)
	if err != nil {
		return TrainingData{}, fmt.Errorf("load training data: %w", err)
	}
	return data, nil
}

// Mutate loads, checks, and persists one typed document atomically. The callback
// must only change the supplied typed graph. The repository merges that graph into the original raw JSON
// object, preserving fields owned by settings, devices, and future clients.
func (r *TrainingDataRepository) Mutate(uid string, expectedRevision *int64, fn func(*TrainingData) error) error {
	if r == nil || r.st == nil {
		return errors.New("training data repository is nil")
	}
	if fn == nil {
		return errors.New("training data mutation callback is nil")
	}
	return r.st.MutateState(uid, func(raw jsontext.Value) (jsontext.Value, error) {
		data, err := decodeTrainingData(raw)
		if err != nil {
			return nil, fmt.Errorf("decode training data: %w", err)
		}
		if expectedRevision != nil && data.Revision != *expectedRevision {
			return nil, &RevisionConflictError{Expected: *expectedRevision, Actual: data.Revision}
		}
		if err := fn(&data); err != nil {
			return nil, err
		}
		return mergeTrainingData(raw, data)
	})
}

// PutBodyweight upserts one dated measurement through the typed repository.
// The MCP handler never needs to inspect or rebuild the persisted JSON blob.
func (r *TrainingDataRepository) PutBodyweight(uid, date string, weight float64) (TrainingData, error) {
	if err := validation.Validator.Struct(MCPBodyweightEntry{D: date, W: weight}); err != nil {
		return TrainingData{}, err
	}

	var updated TrainingData
	err := r.Mutate(uid, nil, func(data *TrainingData) error {
		found := false
		for i := range data.Bodyweight {
			if data.Bodyweight[i].D == date {
				data.Bodyweight[i].W = weight
				found = true
				break
			}
		}
		if !found {
			data.Bodyweight = append(data.Bodyweight, MCPBodyweightEntry{D: date, W: weight, T: new(time.Now().UnixMilli())})
		}
		slices.SortStableFunc(data.Bodyweight, func(a, b MCPBodyweightEntry) int {
			return cmp.Compare(a.D, b.D)
		})
		updated = *data
		return nil
	})
	if err != nil {
		return TrainingData{}, err
	}
	return updated, nil
}

// PutWorkout validates and upserts one completed workout by id. Typed MCP
// inputs make the stored graph closed before it reaches persistence.
func (r *TrainingDataRepository) PutWorkout(uid string, workout MCPWorkout) (MCPWorkout, error) {
	workout.ID = strings.TrimSpace(workout.ID)
	workout.D = strings.TrimSpace(workout.D)
	workout.Name = strings.TrimSpace(workout.Name)
	if workout.Name == "" {
		workout.Name = "Workout"
	}
	if err := validation.Validator.Struct(workout); err != nil {
		return MCPWorkout{}, err
	}

	if err := validateLoadedWorkingSets(workout); err != nil {
		return MCPWorkout{}, err
	}
	encoded, err := json.Marshal(workout)
	if err != nil || len(encoded) > 200_000 {
		return MCPWorkout{}, errors.New("workout too large or invalid")
	}

	err = r.Mutate(uid, nil, func(data *TrainingData) error {
		for i := range data.Workouts {
			if data.Workouts[i].ID == workout.ID {
				workout.ProgressionApplied = append([]string(nil), data.Workouts[i].ProgressionApplied...)
				data.Workouts[i] = workout
				persistRoutineWorkingWeights(data, workout)
				return nil
			}
		}
		data.Workouts = append(data.Workouts, workout)
		persistRoutineWorkingWeights(data, workout)
		return nil
	})
	if err != nil {
		return MCPWorkout{}, err
	}
	return workout, nil
}

// FinalizeWorkout updates the plan after an owner-scoped record commit. A record
// deleted in the meantime stays deleted. Saved-state policies guard replay by id.
func (r *TrainingDataRepository) FinalizeWorkout(uid, id string) error {
	return r.Mutate(uid, nil, func(data *TrainingData) error {
		for _, workout := range data.Workouts {
			if workout.ID == id {
				persistRoutineWorkingWeights(data, workout)
				return nil
			}
		}
		return nil
	})
}

func decodeTrainingData(raw jsontext.Value) (TrainingData, error) {
	data := TrainingData{}
	if len(raw) != 0 {
		if err := json.Unmarshal(raw, &data); err != nil {
			return TrainingData{}, err
		}
	}
	if err := ValidateSchedule(data.Week, data.DayPlan); err != nil {
		return TrainingData{}, err
	}
	normalizeTrainingData(&data)
	return data, nil
}

// decodeDocument uses jsontext values so arbitrary application-owned data is
// preserved byte-for-byte as JSON values without introducing map[string]any
// into the repository boundary.
func decodeDocument(raw jsontext.Value) (map[string]jsontext.Value, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]jsontext.Value{}, nil
	}
	var doc map[string]jsontext.Value
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	if doc == nil {
		return nil, errors.New("training data must be a JSON object")
	}
	return doc, nil
}

func mergeTrainingData(raw jsontext.Value, data TrainingData) (jsontext.Value, error) {
	doc, err := decodeDocument(raw)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	var known map[string]jsontext.Value
	if err := json.Unmarshal(encoded, &known); err != nil {
		return nil, err
	}
	// Remove every field owned by the typed graph before merging it back. This
	// matters for omitempty fields: setting TargetW (or another optional field)
	// to nil must clear the persisted value rather than silently retaining it.
	for _, key := range trainingDataJSONKeys {
		delete(doc, key)
	}
	maps.Copy(doc, known)
	return json.Marshal(doc)
}

// Derive ownership from the persisted type so clearing a newly added optional
// field cannot leave its old value behind in the original document.
var trainingDataJSONKeys = func() []string {
	keys := make([]string, 0, reflect.TypeFor[TrainingData]().NumField())
	for field := range reflect.TypeFor[TrainingData]().Fields() {
		name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
		if name != "" && name != "-" {
			keys = append(keys, name)
		}
	}
	return keys
}()
