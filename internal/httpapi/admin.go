package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/store"
)

// Admin dashboard endpoints (server.js lines 771–855). Every route is gated
// by requireAdmin — cookie sessions only, bearer tokens are never admin
// credentials.

// adminUserRow is one row of GET /api/admin/users.
func (s *Server) adminUserRow(summary store.UserSummary) adminUserSummary {
	u := summary.User
	return adminUserSummary{
		ID: u.ID, Name: u.Name, Created: orNull(u.Created), Disabled: u.Disabled,
		Admin: s.isAdmin(&u), InvitedBy: orNull(u.InvitedBy),
		Workouts: summary.Workouts, LastWorkout: summary.LastWorkout,
		LastSync: summary.LastSync, HasPush: summary.HasPush, Live: s.livePayload(u.ID),
	}
}

// livePayload renders the caller's presence entry exactly like upstream's
// livePresence(): the raw heartbeat object with millisecond stamps, or null.
func (s *Server) livePayload(uid string) *liveResponse {
	p := s.Presence.Live(uid)
	if p == nil {
		return nil
	}
	return &liveResponse{
		Name: p.Name, ExIdx: p.ExIdx, ExTotal: p.ExTotal,
		SetsDone: p.SetsDone, SetsTotal: p.SetsTotal,
		StartedAt: p.StartedAt.UnixMilli(), UpdatedAt: p.UpdatedAt.UnixMilli(),
	}
}

// orNull ports `x || null` for strings.
func orNull(s string) *string {
	if s == "" {
		return nil
	}
	return new(s)
}

// readStateDocument loads the open application document for display.
func (s *Server) readStateDocument(uid string) (stateDocument, error) {
	raw, err := s.ST.ReadState(uid)
	if err != nil {
		return nil, err
	}
	return decodeStateDocument(raw)
}

// GET /api/admin/users — one SQLite snapshot of the compact user summaries.
func (s *Server) adminUsers(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	users, err := s.ST.UserSummaries(r.Context())
	if err != nil {
		serverError(w)
		return
	}
	rows := make([]adminUserSummary, 0, len(users))
	for _, u := range users {
		rows = append(rows, s.adminUserRow(u))
	}
	writeJSON(w, http.StatusOK, struct {
		Users      []adminUserSummary `json:"users"`
		InviteOnly bool               `json:"invite_only"`
		Now        int64              `json:"now"`
	}{Users: rows, InviteOnly: s.Cfg.InviteOnly, Now: time.Now().UnixMilli()})
}

// GET /api/admin/user?id=… — drill-down: full workout history + body-weight
// log for one user, newest workout first.
func (s *Server) adminUser(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	id := r.URL.Query().Get("id")
	u, err := s.ST.UserByID(id) // upstream finds disabled users too
	if err != nil || u == nil {
		writeErr(w, http.StatusNotFound, "no such user")
		return
	}
	st, err := s.readStateDocument(u.ID)
	if err != nil {
		serverError(w)
		return
	}

	var unit string
	_ = json.Unmarshal(st["unit"], &unit)
	var lastSync *float64
	_ = json.Unmarshal(st["_ts"], &lastSync)
	if lastSync != nil && *lastSync == 0 {
		lastSync = nil
	}
	if unit == "" {
		unit = "lb"
	}

	type routineSummary struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Emoji string `json:"emoji"`
		Count int    `json:"count"`
	}
	routines := make([]routineSummary, 0)
	for _, raw := range st.array("routines") {
		if raw.Kind() != '{' {
			continue
		}
		var routine struct {
			ID    string           `json:"id"`
			Name  string           `json:"name"`
			Emoji string           `json:"emoji"`
			Ex    []jsontext.Value `json:"ex"`
		}
		if json.Unmarshal(raw, &routine) != nil {
			continue
		}
		routines = append(routines, routineSummary{ID: routine.ID, Name: routine.Name, Emoji: routine.Emoji, Count: len(routine.Ex)})
	}
	bodyweight := st.array("bodyweight")
	workouts := st.array("workouts")
	slices.Reverse(workouts)

	writeJSON(w, http.StatusOK, struct {
		User       adminUserPayload `json:"user"`
		Unit       string           `json:"unit"`
		LastSync   *float64         `json:"lastSync"`
		Routines   []routineSummary `json:"routines"`
		Bodyweight []jsontext.Value `json:"bodyweight"`
		Workouts   []jsontext.Value `json:"workouts"`
	}{
		User: adminUserPayload{
			ID: u.ID, Name: u.Name, Created: orNull(u.Created), Disabled: u.Disabled,
			Admin: s.isAdmin(u), InvitedBy: orNull(u.InvitedBy),
		},
		Unit: unit, LastSync: lastSync, Routines: routines,
		Bodyweight: bodyweight, Workouts: workouts,
	})
}

// POST /api/admin/user/disable — flips the disabled flag; refuses admins and
// drops freshly disabled users off "training now" at once.
func (s *Server) adminDisable(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	var body struct {
		ID       string `json:"id" validate:"required"`
		Disabled bool   `json:"disabled"`
	}
	if !readValidatedJSON(w, r, &body) {
		return
	}
	u, err := s.ST.UserByID(body.ID) // upstream finds disabled users too
	if err != nil || u == nil {
		writeErr(w, http.StatusNotFound, "no such user")
		return
	}
	if s.isAdmin(u) {
		writeErr(w, http.StatusBadRequest, "cannot disable an admin")
		return
	}
	disabled := body.Disabled
	if err := s.ST.SetDisabled(u.ID, disabled); err != nil {
		serverError(w)
		return
	}
	if disabled {
		s.Presence.Delete(u.ID)
	}
	writeJSON(w, http.StatusOK, struct {
		OK       bool   `json:"ok"`
		ID       string `json:"id"`
		Disabled bool   `json:"disabled"`
	}{OK: true, ID: u.ID, Disabled: disabled})
}

// GET /api/admin/invites — every invite plus usedBy uid → name resolved for
// display.
func (s *Server) adminInvites(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	invites, err := s.ST.Invites()
	if err != nil {
		serverError(w)
		return
	}
	out := make([]inviteResponse, 0, len(invites))
	for _, i := range invites {
		var usedByName *string
		if i.UsedBy != "" {
			if u, err := s.ST.UserByID(i.UsedBy); err == nil && u != nil { // upstream finds disabled users too
				usedByName = new(u.Name)
			}
		}
		out = append(out, inviteResponse{
			Code: i.Code, Note: i.Note, CreatedBy: i.CreatedBy, Created: i.Created,
			UsedBy: i.UsedBy, UsedAt: i.UsedAt, Revoked: i.Revoked, UsedByName: usedByName,
		})
	}
	writeJSON(w, http.StatusOK, struct {
		Invites    []inviteResponse `json:"invites"`
		InviteOnly bool             `json:"invite_only"`
	}{Invites: out, InviteOnly: s.Cfg.InviteOnly})
}

// POST /api/admin/invites/new — mints a 16-hex-char code (64 bits; the app
// has no rate limiting by design, so the code itself is what isn't worth
// guessing). Codes already in the database keep working — validation is an
// exact string compare, never a length or format check.
func (s *Server) adminNewInvite(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	var body struct {
		Note string `json:"note" validate:"max=60"`
	}
	if !readValidatedJSON(w, r, &body) {
		return
	}
	existing, err := s.ST.Invites()
	if err != nil {
		serverError(w)
		return
	}
	known := map[string]bool{}
	for _, i := range existing {
		known[i.Code] = true
	}
	var code string
	for {
		var raw [8]byte
		if _, err := rand.Read(raw[:]); err != nil {
			serverError(w)
			return
		}
		code = strings.ToUpper(hex.EncodeToString(raw[:]))
		if !known[code] {
			break
		}
	}
	invite := store.Invite{
		Code:      code,
		Note:      body.Note,
		CreatedBy: admin.ID,
		Created:   time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	}
	if err := s.ST.UpsertInvite(invite); err != nil {
		serverError(w)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Invite store.Invite `json:"invite"`
	}{Invite: invite})
}

// POST /api/admin/invites/revoke — deletes an unused code; used codes stay
// forever so the audit trail survives.
func (s *Server) adminRevokeInvite(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	var body struct {
		Code string `json:"code" validate:"required"`
	}
	if !readValidatedJSON(w, r, &body) {
		return
	}
	code := strings.ToUpper(body.Code)
	invites, err := s.ST.Invites()
	if err != nil {
		serverError(w)
		return
	}
	var found *store.Invite
	for i := range invites {
		if invites[i].Code == code {
			found = &invites[i]
			break
		}
	}
	if found == nil {
		writeErr(w, http.StatusNotFound, "no such code")
		return
	}
	if found.UsedBy != "" {
		writeErr(w, http.StatusBadRequest, "already used — cannot revoke")
		return
	}
	if err := s.ST.DeleteInvite(found.Code); err != nil {
		serverError(w)
		return
	}
	writeJSON(w, http.StatusOK, okResponse{OK: true})
}
