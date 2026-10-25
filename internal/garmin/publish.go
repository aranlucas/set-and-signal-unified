package garmin

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"time"
)

type PublishRequest struct {
	ID      string         `json:"id"`
	Date    string         `json:"date"`
	Workout jsontext.Value `json:"workout"`
}

type Publication struct {
	ID         string `json:"id"`
	Date       string `json:"date"`
	Phase      string `json:"phase"`
	WorkoutID  int64  `json:"workoutId,omitzero"`
	ScheduleID int64  `json:"scheduleId,omitzero"`
	Message    string `json:"message"`
}

type savedPublication struct {
	Publication
	Hash string `json:"hash"`
}

// Publish journals the operation before dispatch. Replays return its last known
// outcome, including ambiguous responses; they never blindly repeat a write.
func (s *Service) Publish(ctx context.Context, uid string, request PublishRequest) (Publication, error) {
	if len(request.ID) < 8 || len(request.ID) > 100 || len(request.Workout) == 0 || len(request.Workout) > 200000 || request.Workout.Kind() != '{' {
		return Publication{}, errors.New("invalid workout publication")
	}
	date, err := time.Parse("2006-01-02", request.Date)
	if err != nil || date.Format("2006-01-02") != request.Date {
		return Publication{}, errors.New("invalid calendar date")
	}
	canonical := request.Workout.Clone()
	if err := canonical.Canonicalize(); err != nil {
		return Publication{}, err
	}
	digest := sha256.Sum256(append([]byte(request.Date+":"), canonical...))
	hash := hex.EncodeToString(digest[:])
	key := "publish/" + uid + "/" + request.ID
	unlock := s.lock(key)
	defer unlock()
	var saved savedPublication
	if err := s.read(key, &saved, false); err == nil {
		if saved.Hash != hash {
			return Publication{}, errors.New("publication id was used for different workout details")
		}
		return saved.Publication, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Publication{}, err
	}
	// Check authorization before marking any upstream write in flight.
	if _, err := s.token(ctx, uid); err != nil {
		return Publication{}, err
	}
	saved = savedPublication{ID: request.ID, Date: request.Date, Phase: "needs_review", Message: "A write may have succeeded. Check Garmin Connect before sending again.", Hash: hash}
	if err := s.save(key, saved, uid); err != nil {
		return Publication{}, err
	}
	data, err := s.Call(ctx, uid, "create_workout", struct {
		Workout jsontext.Value `json:"workout"`
	}{request.Workout})
	if err != nil {
		return saved.Publication, nil
	}
	var created struct {
		WorkoutID int64 `json:"workoutId"`
	}
	if err := json.Unmarshal(data, &created); err != nil || created.WorkoutID <= 0 {
		return saved.Publication, nil
	}
	saved.WorkoutID = created.WorkoutID
	// Durably retain the created ID before the second, independently ambiguous write.
	if err := s.save(key, saved, uid); err != nil {
		return saved.Publication, err
	}
	data, err = s.Call(ctx, uid, "schedule_workout", struct {
		WorkoutID int64  `json:"workoutId"`
		Date      string `json:"date"`
	}{created.WorkoutID, request.Date})
	if err != nil {
		return saved.Publication, nil
	}
	var scheduled struct {
		ScheduleID int64 `json:"scheduleId"`
	}
	if err := json.Unmarshal(data, &scheduled); err != nil || scheduled.ScheduleID <= 0 {
		return saved.Publication, nil
	}
	saved.ScheduleID = scheduled.ScheduleID
	saved.Phase = "scheduled"
	saved.Message = "Scheduled in Garmin Connect. Sync your watch to download it; watch delivery is not confirmed."
	if err := s.save(key, saved, uid); err != nil {
		return saved.Publication, err
	}
	return saved.Publication, nil
}
