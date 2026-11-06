package httpapi

import (
	"encoding/json/jsontext"

	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

// Keep fixed HTTP response shapes concrete. Open application documents stay
// raw JSON so fields owned by clients can pass through without losing data.
type okResponse struct {
	OK bool `json:"ok"`
}

type userResponse struct {
	User userPayload `json:"user"`
}

type userPayload struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Admin bool   `json:"admin"`
}

type routineResponse struct {
	OK      bool                `json:"ok"`
	Routine training.MCPRoutine `json:"routine"`
}

type programResponse struct {
	OK       bool                   `json:"ok"`
	Routines []training.MCPRoutine  `json:"routines"`
	Week     *training.WeekSchedule `json:"week,omitzero"`
}

type bodyweightResponse struct {
	OK   bool   `json:"ok"`
	Date string `json:"date"`
}

type settingsResponse struct {
	OK      bool     `json:"ok"`
	Applied []string `json:"applied"`
}

type liveResponse struct {
	Name      string `json:"name"`
	ExIdx     int    `json:"exIdx"`
	ExTotal   int    `json:"exTotal"`
	SetsDone  int    `json:"setsDone"`
	SetsTotal int    `json:"setsTotal"`
	StartedAt int64  `json:"startedAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type adminUserPayload struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Created   *string `json:"created"`
	Disabled  bool    `json:"disabled"`
	Admin     bool    `json:"admin"`
	InvitedBy *string `json:"invitedBy"`
}

type adminUserSummary struct {
	adminUserPayload
	Workouts    int            `json:"workouts"`
	LastWorkout jsontext.Value `json:"lastWorkout"`
	LastSync    jsontext.Value `json:"lastSync"`
	HasPush     bool           `json:"hasPush"`
	Live        *liveResponse  `json:"live"`
}

type inviteResponse struct {
	Code       string  `json:"code"`
	Note       string  `json:"note"`
	CreatedBy  string  `json:"createdBy"`
	Created    string  `json:"created"`
	UsedBy     string  `json:"usedBy"`
	UsedAt     string  `json:"usedAt"`
	Revoked    bool    `json:"revoked"`
	UsedByName *string `json:"usedByName"`
}
