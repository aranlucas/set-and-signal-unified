// Package exercises ships a compact catalog of the web app's exercise library
// for MCP search and AI digest name resolution.
package exercises

import (
	"cmp"
	catalogdata "github.com/aranlucas/set-and-signal-unified/packages/exercises"
	"encoding/json/v2"
	"slices"
	"strings"
	"sync"
	"unicode"
)

var catalogJSON = catalogdata.Catalog

// Exercise is one catalog row (id, name, body part, equipment, target, synergists).
type Exercise struct {
	ID string   `json:"id"`
	N  string   `json:"n"`
	BP string   `json:"bp,omitempty"`
	EQ string   `json:"eq,omitempty"`
	TG string   `json:"tg,omitempty"`
	SM []string `json:"sm,omitempty"`
}

var (
	all  []Exercise
	byID map[string]Exercise
	load = sync.OnceFunc(func() {
		if err := json.Unmarshal(catalogJSON, &all); err != nil {
			panic("exercises catalog: " + err.Error())
		}
		byID = make(map[string]Exercise, len(all))
		for _, e := range all {
			byID[e.ID] = e
		}
	})
)

// All returns the full catalog (read-only; do not mutate).
func All() []Exercise {
	load()
	return all
}

// Lookup returns a catalog exercise by id.
func Lookup(id string) (Exercise, bool) {
	load()
	e, ok := byID[id]
	return e, ok
}

// NameOf resolves an exercise id to a display name; customEx entries win over the catalog.
func NameOf(id string, customEx []Exercise) string {
	for _, exercise := range customEx {
		if exercise.ID == id {
			if exercise.N != "" {
				return exercise.N
			}
			break
		}
	}
	if e, ok := Lookup(id); ok {
		return e.N
	}
	return id
}

// SearchFilters optionally restrict by body part / equipment.
type SearchFilters struct {
	BodyPart  string
	Equipment string
	Limit     int
}

// Search ranks catalog (+ optional custom) exercises like the web searchExercises helper.
func Search(query string, custom []Exercise, f SearchFilters) []Exercise {
	load()
	limit := f.Limit
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}

	pool := make([]Exercise, 0, len(custom)+len(all))
	pool = append(pool, custom...)
	pool = append(pool, all...)

	nq := normalizeSearchText(query)
	tokens := strings.Fields(nq)

	type hit struct {
		ex    Exercise
		index int
		score int
	}
	hits := make([]hit, 0, 32)
	for i, ex := range pool {
		if f.BodyPart != "" && ex.BP != f.BodyPart {
			continue
		}
		if f.Equipment != "" && ex.EQ != f.Equipment {
			continue
		}
		if len(tokens) == 0 {
			hits = append(hits, hit{ex: ex, index: i, score: 0})
			continue
		}
		nn := normalizeSearchText(ex.N)
		parts := []string{ex.N, ex.BP, ex.EQ, ex.TG}
		parts = append(parts, ex.SM...)
		hay := normalizeSearchText(strings.Join(filterNonEmpty(parts), " "))
		ok := true
		for _, t := range tokens {
			if !strings.Contains(hay, t) {
				ok = false
				break
			}
		}
		if !ok {
			continue
		}
		score := 3
		switch {
		case nn == nq:
			score = 0
		case strings.Contains(nn, nq):
			score = 1
		default:
			allInName := true
			for _, t := range tokens {
				if !strings.Contains(nn, t) {
					allInName = false
					break
				}
			}
			if allInName {
				score = 2
			}
		}
		hits = append(hits, hit{ex: ex, index: i, score: score})
	}
	slices.SortStableFunc(hits, func(a, b hit) int {
		if byScore := cmp.Compare(a.score, b.score); byScore != 0 {
			return byScore
		}
		return cmp.Compare(a.index, b.index)
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}
	out := make([]Exercise, len(hits))
	for i, h := range hits {
		out[i] = h.ex
	}
	return out
}

func filterNonEmpty(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// normalizeSearchText mirrors web/src/domain/exercises/exercises.ts (NFD strip + separators).
func normalizeSearchText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	b.Grow(len(value))
	prevSpace := false
	for _, r := range value {
		// Strip combining marks after NFD-ish: drop Mn category.
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		switch r {
		case '&':
			if !prevSpace {
				b.WriteByte(' ')
			}
			b.WriteString("and")
			b.WriteByte(' ')
			prevSpace = true
			continue
		case '-', '/', ',', '.', ':', ';', '_', '(', ')', '[', ']', '{', '}', '|', '+', '*', '?', '!', '"', '\'', '\\':
			r = ' '
		}
		if unicode.IsSpace(r) {
			if prevSpace || b.Len() == 0 {
				continue
			}
			b.WriteByte(' ')
			prevSpace = true
			continue
		}
		b.WriteRune(r)
		prevSpace = false
	}
	return strings.TrimSpace(b.String())
}
