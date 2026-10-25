// Package push ports upstream Web Push handling from api/server.js §"push
// notifications" (lines 60–150): VAPID key management, urgency-high sends with
// 404/410 subscription pruning, replace-per-user rest timers, and the
// once-per-user-per-day workout reminder loop.
package push

import (
	"cmp"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/aranlucas/set-and-signal-unified/internal/store"
	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

// reminderInterval is the tick cadence of RunReminderLoop. Upstream ticks every
// 10s (not 60s) because ticks aren't aligned to the top of the minute; a 60s
// interval could sit on the target minute for up to 59s before noticing.
// Var only so tests can shrink it.
var reminderInterval = 10 * time.Second

// vapidKeys mirrors web-push's generateVAPIDKeys() JSON as persisted to
// $DATA_DIR/vapid.json (server.js lines 60–63).
type vapidKeys struct {
	PublicKey  string `json:"publicKey"`
	PrivateKey string `json:"privateKey"`
}

// StatusError reports an HTTP status from a push service. SendTo prunes the
// subscription when it wraps a 404 or 410.
type StatusError struct {
	StatusCode int
	Body       string
}

func (e *StatusError) Error() string {
	if e.Body != "" {
		return fmt.Sprintf("push service returned %d: %s", e.StatusCode, e.Body)
	}
	return fmt.Sprintf("push service returned %d", e.StatusCode)
}

// notification is the wire payload every send carries (upstream sends exactly
// {title, body, tag}).
type notification struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Tag   string `json:"tag"`
}

// Service sends Web Push notifications for one instance. Create with New.
type Service struct {
	st      *store.Store
	subject string

	pub, priv string

	log *log.Logger

	// httpClient is injectable so tests can use Go's in-memory HTTP transport.
	httpClient *http.Client

	// send is the seam between Service and the actual push delivery so tests
	// can capture or stub requests. The default posts via webpush-go with
	// urgency high.
	send func(sub store.PushSub, payload []byte) error

	mu     sync.Mutex
	timers map[string]*time.Timer // userId -> pending rest timer
}

// New loads $DATA_DIR/vapid.json or generates it once (mode 0600), mirroring
// server.js lines 60–66.
func New(dataDir string, st *store.Store, subject string) (*Service, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("push: create data dir: %w", err)
	}
	file := filepath.Join(dataDir, "vapid.json")

	var keys vapidKeys
	raw, err := os.ReadFile(file)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("push: read %s: %w", file, err)
	}
	// A corrupt or empty file regenerates rather than failing the server: the
	// only cost is existing subscriptions re-subscribing to the new key.
	if err == nil {
		_ = json.Unmarshal(raw, &keys)
	}
	if keys.PublicKey == "" || keys.PrivateKey == "" {
		priv, pub, err := webpush.GenerateVAPIDKeys()
		if err != nil {
			return nil, fmt.Errorf("push: generate VAPID keys: %w", err)
		}
		keys = vapidKeys{PublicKey: pub, PrivateKey: priv}
		out, _ := json.Marshal(keys)
		if err := os.WriteFile(file, out, 0o600); err != nil {
			return nil, fmt.Errorf("push: write %s: %w", file, err)
		}
	}

	p := &Service{
		st:         st,
		subject:    subject,
		pub:        keys.PublicKey,
		priv:       keys.PrivateKey,
		log:        log.New(os.Stderr, "push: ", log.LstdFlags|log.Lmsgprefix),
		httpClient: &http.Client{Timeout: 30 * time.Second},
		timers:     map[string]*time.Timer{},
	}
	p.send = p.deliver
	return p, nil
}

// PublicKey returns the VAPID public key the frontend subscribes with.
func (p *Service) PublicKey() string { return p.pub }

// deliver is the default sender: encrypt and POST with urgency high. TTL is
// the web-push library's 28-day default — same as upstream, where leaving TTL
// unset means web-push sends its 2419200s default and a briefly-offline
// device still receives the message once reconnected. (webpush-go would
// otherwise send "TTL: 0" = deliver-or-discard.)
const messageTTL = 2419200 // seconds; matches web-push's JS default

func (p *Service) deliver(sub store.PushSub, payload []byte) error {
	resp, err := webpush.SendNotification(payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{Auth: sub.Auth, P256dh: sub.P256DH},
	}, &webpush.Options{
		Subscriber:      p.subject,
		VAPIDPublicKey:  p.pub,
		VAPIDPrivateKey: p.priv,
		Urgency:         webpush.UrgencyHigh,
		TTL:             messageTTL,
		// webpush-go falls back to an http.Client with no timeout, so one
		// hung push endpoint would stall handlers and the reminder loop
		// forever. Bound every send.
		HTTPClient: p.httpClient,
	})
	if err != nil {
		return err // transport-level failure; not prunable
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		body := make([]byte, 512)
		n, _ := resp.Body.Read(body)
		return &StatusError{StatusCode: resp.StatusCode, Body: string(body[:n])}
	}
	return nil
}

// SendTo delivers {title, body, tag} to every subscription owned by uid,
// pruning subscriptions the push service reports gone (404/410).
func (p *Service) SendTo(uid, title, body, tag string) {
	subs, err := p.st.SubsByUser(uid)
	if err != nil {
		p.log.Printf("list subs for %s: %v", uid, err)
		return
	}
	payload, err := json.Marshal(notification{Title: title, Body: body, Tag: tag})
	if err != nil {
		return
	}
	for _, sub := range subs {
		err := p.send(sub, payload)
		if err == nil {
			continue
		}
		if se, ok := errors.AsType[*StatusError](err); ok {
			p.log.Printf("push send failed %s %d %s", uid, se.StatusCode, se.Body)
			if se.StatusCode == 404 || se.StatusCode == 410 {
				if derr := p.st.DeletePushSub(sub.Endpoint); derr != nil {
					p.log.Printf("prune sub %s: %v", sub.Endpoint, derr)
				}
			}
			continue
		}
		p.log.Printf("push send failed %s: %v", uid, err)
	}
}

// ScheduleRestTimer arms (replacing any prior timer for uid) the rest-over
// alert. The client schedules on start/extend and cancels on skip or on-screen
// completion, so this only ever fires when the tab was backgrounded/suspended
// and never got to cancel itself.
func (p *Service) ScheduleRestTimer(uid string, sec int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if t := p.timers[uid]; t != nil {
		t.Stop()
	}
	p.timers[uid] = time.AfterFunc(time.Duration(sec)*time.Second, func() {
		p.mu.Lock()
		delete(p.timers, uid)
		p.mu.Unlock()
		p.SendTo(uid, "Rest over 💪", "Time for your next set.", "rest-timer")
	})
}

// CancelRestTimer disarms the pending rest timer, if any.
func (p *Service) CancelRestTimer(uid string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if t := p.timers[uid]; t != nil {
		t.Stop()
		delete(p.timers, uid)
	}
}

// nowResult carries the injected clock reading of RunReminderLoop: date as
// YYYY-MM-DD, hhmm as HH:MM, both resolved in the user's own IANA zone. ok is
// false when the zone is unknown — the user is skipped rather than guessed.
type nowResult struct {
	date string
	hhmm string
	ok   bool
}

// reminderState is the slice of the per-user state document the reminder loop
// reads (same shape as the current frontend state contract).
type reminderState struct {
	Reminder *struct {
		On   bool   `json:"on"`
		TZ   string `json:"tz"`
		Time string `json:"time"`
	} `json:"reminder"`
	DayPlan  training.DayPlanMap `json:"dayPlan"`
	Routines []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"routines"`
	Week     training.WeekSchedule `json:"week"`
	Workouts []struct {
		D         string `json:"d"`
		RoutineID string `json:"routineId"`
	} `json:"workouts"`
}

// effectiveRoutineId returns the next unfinished planned routine. A daily
// reminder is still sent at most once, even when several sessions remain.
func effectiveRoutineId(s *reminderState, iso string) string {
	t, err := time.Parse("2006-01-02", iso)
	if err != nil {
		return ""
	}
	sessions := s.Week[strconv.Itoa(int(t.Weekday()))]
	if entry, ok := s.DayPlan[iso]; ok {
		if entry.Rest || len(entry.Sessions) == 0 {
			return ""
		}
		ids := knownRoutineIDs(s)
		valid := make([]training.MCPDaySession, 0, len(entry.Sessions))
		for _, session := range entry.Sessions {
			if ids[session.RoutineID] {
				valid = append(valid, session)
			}
		}
		if len(valid) > 0 {
			sessions = valid
		}
	}
	completed := map[string]int{}
	for _, workout := range s.Workouts {
		if workout.D == iso && workout.RoutineID != "" {
			completed[workout.RoutineID]++
		}
	}
	for _, session := range sessions {
		if completed[session.RoutineID] > 0 {
			completed[session.RoutineID]--
			continue
		}
		return session.RoutineID
	}
	return ""
}

func knownRoutineIDs(s *reminderState) map[string]bool {
	ids := make(map[string]bool, len(s.Routines))
	for _, r := range s.Routines {
		ids[r.ID] = true
	}
	return ids
}

func decodeReminderState(raw jsontext.Value) (reminderState, error) {
	var s reminderState
	if err := json.Unmarshal(raw, &s); err != nil {
		return reminderState{}, err
	}
	if err := training.ValidateSchedule(s.Week, s.DayPlan); err != nil {
		return reminderState{}, err
	}
	if s.Week == nil {
		s.Week = training.WeekSchedule{}
	}
	if s.DayPlan == nil {
		s.DayPlan = training.DayPlanMap{}
	}
	return s, nil
}

// RunReminderLoop fires each subscribed user's day reminder at most once per
// local calendar day, ticking every reminderInterval until ctx ends. nowFn
// resolves the current instant in the named IANA zone (time.LoadLocation
// semantics); production passes a wrapper around time.Now.
func (p *Service) RunReminderLoop(ctx context.Context, nowFn func(tz string) (date, hhmm string, ok bool)) {
	ticks := time.Tick(reminderInterval)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticks:
			p.reminderTick(nowFn)
		}
	}
}

func (p *Service) reminderTick(nowFn func(tz string) (date, hhmm string, ok bool)) {
	users, err := p.st.Users()
	if err != nil {
		p.log.Printf("list users: %v", err)
		return
	}
	for i := range users {
		user := users[i]
		hasSub, err := p.st.AnySubFor(user.ID)
		if err != nil {
			p.log.Printf("subs check %s: %v", user.ID, err)
			continue
		}
		if !hasSub {
			continue
		}
		raw, err := p.st.ReadState(user.ID)
		if err != nil {
			p.log.Printf("read state %s: %v", user.ID, err)
			continue
		}
		s, err := decodeReminderState(raw)
		if err != nil {
			p.log.Printf("parse state %s: %v", user.ID, err)
			continue
		}
		if s.Reminder == nil || !s.Reminder.On {
			continue
		}
		date, hhmm, ok := nowFn(cmp.Or(s.Reminder.TZ, "UTC"))
		now := nowResult{date: date, hhmm: hhmm, ok: ok}
		if !ok || s.Reminder.Time != now.hhmm {
			continue
		}
		if user.LastReminder == now.date {
			continue
		}
		rid := effectiveRoutineId(&s, now.date)
		if rid == "" {
			continue // rest day — nothing planned
		}
		title := "Workout planned today"
		for _, r := range s.Routines {
			if r.ID == rid {
				title = r.Name + " today"
				break
			}
		}
		if err := p.st.SetLastReminder(user.ID, now.date); err != nil {
			p.log.Printf("set last_reminder %s: %v", user.ID, err)
			continue
		}
		p.SendTo(user.ID, title, "It's on your plan — let's go 💪", "day-reminder")
	}
}
