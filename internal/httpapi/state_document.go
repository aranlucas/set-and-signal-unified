package httpapi

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"slices"

	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

// stateDocument preserves application-owned fields. Mutations decode only
// the projection they need and write back only fields they actually edit.
type stateDocument map[string]jsontext.Value

func decodeStateDocument(raw jsontext.Value) (stateDocument, error) {
	if len(raw) == 0 || raw.Kind() == 'n' {
		return stateDocument{}, nil
	}
	var document stateDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, err
	}
	if document == nil {
		return nil, errors.New("state must be an object")
	}
	return document, nil
}

func (d stateDocument) set[T any](key string, value T) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	d[key] = raw
	return nil
}

func (d stateDocument) array(key string) []jsontext.Value {
	var values []jsontext.Value
	if raw := d[key]; raw.Kind() == '[' {
		_ = json.Unmarshal(raw, &values)
	}
	if values == nil {
		values = []jsontext.Value{}
	}
	return values
}

// storedRoutine exposes the identity used by upserts while retaining the
// complete JSON of untouched entries, including future exercise fields.
type storedRoutine struct {
	ID  *string
	raw jsontext.Value
}

func (r *storedRoutine) UnmarshalJSON(raw []byte) error {
	r.raw = jsontext.Value(raw).Clone()
	r.ID = nil
	var identity struct {
		ID *string `json:"id"`
	}
	if json.Unmarshal(raw, &identity) == nil {
		r.ID = identity.ID
	}
	return nil
}

func (r storedRoutine) MarshalJSON() ([]byte, error) { return r.raw.MarshalJSON() }

type storedRoutines []storedRoutine

func (d stateDocument) routines() storedRoutines {
	var routines storedRoutines
	if raw := d["routines"]; raw.Kind() == '[' {
		_ = json.Unmarshal(raw, &routines)
	}
	if routines == nil {
		routines = storedRoutines{}
	}
	return routines
}

func (r *storedRoutines) upsert(routine training.MCPRoutine) error {
	raw, err := json.Marshal(routine)
	if err != nil {
		return err
	}
	entry := storedRoutine{ID: new(routine.ID), raw: raw}
	index := slices.IndexFunc(*r, func(existing storedRoutine) bool {
		return existing.ID != nil && *existing.ID == routine.ID
	})
	if index >= 0 {
		(*r)[index] = entry
	} else {
		*r = append(*r, entry)
	}
	return nil
}

func (r storedRoutines) ids() map[string]bool {
	ids := make(map[string]bool, len(r))
	for _, routine := range r {
		if routine.ID != nil {
			ids[*routine.ID] = true
		}
	}
	return ids
}

type storedMeasurement struct {
	Date *string
	raw  jsontext.Value
}

func (m *storedMeasurement) UnmarshalJSON(raw []byte) error {
	m.raw = jsontext.Value(raw).Clone()
	m.Date = nil
	var identity struct {
		Date *string `json:"d"`
	}
	if json.Unmarshal(raw, &identity) == nil {
		m.Date = identity.Date
	}
	return nil
}

func (m storedMeasurement) MarshalJSON() ([]byte, error) { return m.raw.MarshalJSON() }

func (m storedMeasurement) date() string {
	if m.Date == nil {
		return ""
	}
	return *m.Date
}

func (d stateDocument) measurements() []storedMeasurement {
	var measurements []storedMeasurement
	if raw := d["bodyweight"]; raw.Kind() == '[' {
		_ = json.Unmarshal(raw, &measurements)
	}
	if measurements == nil {
		measurements = []storedMeasurement{}
	}
	return measurements
}

func (s *Server) mutateDocument(uid string, mutate func(stateDocument) error) error {
	return s.ST.MutateState(uid, func(raw jsontext.Value) (jsontext.Value, error) {
		document, err := decodeStateDocument(raw)
		if err != nil {
			return nil, err
		}
		if err := mutate(document); err != nil {
			return nil, err
		}
		return json.Marshal(document)
	})
}
