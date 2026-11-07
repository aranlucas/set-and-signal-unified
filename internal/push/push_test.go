package push

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json/v2"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/aranlucas/set-and-signal-unified/internal/store"
	"github.com/aranlucas/set-and-signal-unified/internal/training"
)

// ---------- fake push service ----------

// capturedSend is one delivery attempt. Via the httptest endpoint only the
// encrypted body arrives, so Title/Body/Tag stay empty there; the sender-seam
// recorder fills them from the pre-encryption payload.
type capturedSend struct {
	UserID  string
	Path    string
	Urgency string
	TTL     string
	Payload notification
}

type fakePushService struct {
	mu    sync.Mutex
	sends []capturedSend
	code  map[string]int // path -> status to return (default 201)
	srv   *httptest.Server
}

func (f *fakePushService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)

	f.mu.Lock()
	f.sends = append(f.sends, capturedSend{
		Path:    r.URL.Path,
		Urgency: r.Header.Get("Urgency"),
		TTL:     r.Header.Get("TTL"),
	})
	code := f.code[r.URL.Path]
	if code == 0 {
		code = http.StatusCreated
	}
	f.mu.Unlock()

	w.WriteHeader(code)
	if code >= 300 {
		_, _ = w.Write([]byte("gone"))
	}
	_ = body // aes128gcm ciphertext; not decryptable without the device key
}

func (f *fakePushService) all() []capturedSend {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.sends)
}

func (f *fakePushService) count() int { return len(f.all()) }

func countTag(sends []capturedSend, tag string) int {
	n := 0
	for _, s := range sends {
		if s.Payload.Tag == tag {
			n++
		}
	}
	return n
}

func (f *fakePushService) setCode(path string, code int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.code == nil {
		f.code = map[string]int{}
	}
	f.code[path] = code
}

// captureSeam replaces the service's send function with a recorder that sees
// the plaintext payload — the seam exists so tests don't need real webpush.
func (f *fakePushService) captureSeam(p *Service) {
	p.send = func(sub store.PushSub, payload []byte) error {
		var n notification
		_ = json.Unmarshal(payload, &n)
		f.mu.Lock()
		defer f.mu.Unlock()
		f.sends = append(f.sends, capturedSend{
			UserID:  sub.UserID,
			Payload: n,
		})
		code := f.code[sub.UserID]
		if code >= 300 {
			return &StatusError{StatusCode: code, Body: "gone"}
		}
		return nil
	}
}

// subscriptionKeys generates a fresh receiver keypair so webpush-go's
// ECDH-based message encryption succeeds against the fake service.
func subscriptionKeys(t *testing.T) (p256dh, auth string) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate sub key: %v", err)
	}
	point, err := priv.PublicKey.Bytes()
	if err != nil {
		t.Fatalf("encode sub key: %v", err)
	}

	rawAuth := make([]byte, 16)
	if _, err := rand.Read(rawAuth); err != nil {
		t.Fatalf("generate auth secret: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(point),
		base64.RawURLEncoding.EncodeToString(rawAuth)
}

type harness struct {
	st   *store.Store
	push *Service
	fake *fakePushService
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{fake: &fakePushService{}}

	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store open: %v", err)
	}
	h.st = st
	t.Cleanup(func() { _ = h.st.DB.Close() })

	h.push, err = New(t.TempDir(), h.st, "mailto:admin@localhost")
	if err != nil {
		t.Fatalf("push.New: %v", err)
	}
	h.fake.srv = httptest.NewTestServer(t, h.fake)
	h.push.httpClient = h.fake.srv.Client()
	return h
}

// addUser creates a user plus one push subscription pointed at the fake
// service under the given path ("" = no subscription).
func (h *harness) addUser(t *testing.T, id, subPath string) {
	t.Helper()
	if err := h.st.CreateUser(store.User{ID: id, Name: id, Created: time.Now().UTC().Format(time.RFC3339)}); err != nil {
		t.Fatalf("create user %s: %v", id, err)
	}
	if subPath == "" {
		return
	}
	h.addUserSub(t, id, subPath)
}

// addUserSub attaches another push subscription to an existing user.
func (h *harness) addUserSub(t *testing.T, id, subPath string) {
	t.Helper()
	p256dh, auth := subscriptionKeys(t)
	err := h.st.UpsertPushSub(store.PushSub{
		Endpoint: h.fake.srv.URL + "/" + subPath,
		UserID:   id,
		P256DH:   p256dh,
		Auth:     auth,
		Created:  time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("upsert sub %s: %v", id, err)
	}
}

func (h *harness) writeState(t *testing.T, uid string, doc map[string]any) {
	t.Helper()
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal state: %v", err)
	}
	if err := h.st.WriteState(uid, raw); err != nil {
		t.Fatalf("write state: %v", err)
	}
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// reminderStateDoc builds a state document with reminder enabled at hhmm and a
// week grid of rest/push/legs days.
func reminderStateDoc(hhmm string) map[string]any {
	return map[string]any{
		"reminder": map[string]any{"on": true, "tz": "UTC", "time": hhmm},
		"routines": []map[string]any{
			{"id": "push", "name": "Push Day", "emoji": "arm"},
			{"id": "legs", "name": "Leg Day", "emoji": "legs"},
		},
		"week": training.WeekSchedule{"1": {{RoutineID: "push"}}, "2": {{RoutineID: "legs"}}, "3": {{RoutineID: "push"}}, "4": {{RoutineID: "legs"}}, "5": {{RoutineID: "push"}}},
	}
}

// ---------- vapid.json ----------

func TestVapidJSONCreatedOnceReusedAfterwards(t *testing.T) {
	dataDir := t.TempDir()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store open: %v", err)
	}
	defer func() { _ = st.DB.Close() }()

	p1, err := New(dataDir, st, "mailto:admin@localhost")
	if err != nil {
		t.Fatalf("first New: %v", err)
	}
	p2, err := New(dataDir, st, "mailto:admin@localhost")
	if err != nil {
		t.Fatalf("second New: %v", err)
	}
	if p1.PublicKey() == "" || p1.PublicKey() != p2.PublicKey() {
		t.Fatalf("expected stable public key, got %q vs %q", p1.PublicKey(), p2.PublicKey())
	}
}

// ---------- SendTo ----------

func TestSendToDeliversUrgencyHighAndPrunesOn410(t *testing.T) {
	h := newHarness(t) // real sender against the fake push endpoint
	h.addUser(t, "u1", "alive")
	h.addUser(t, "u2", "gone")
	h.fake.setCode("/gone", http.StatusGone)

	h.push.SendTo("u1", "Hello", "World", "tag-a")
	waitFor(t, "send to u1", func() bool { return h.fake.count() == 1 })

	sent := h.fake.all()[0]
	if sent.Path != "/alive" || sent.Urgency != "high" {
		t.Fatalf("unexpected send headers: %+v", sent)
	}
	if sent.TTL != "2419200" { // web-push default; "TTL: 0" would mean deliver-or-discard
		t.Fatalf("TTL header = %q, want 2419200", sent.TTL)
	}

	// u2's endpoint reports 410 — the sub must be pruned and not retried.
	h.push.SendTo("u2", "Hello", "World", "tag-b")
	waitFor(t, "send to u2", func() bool { return h.fake.count() == 2 })

	subs, err := h.st.SubsByUser("u2")
	if err != nil {
		t.Fatalf("subs by user: %v", err)
	}
	if len(subs) != 0 {
		t.Fatalf("expected 410 sub pruned, %d remain", len(subs))
	}

	before := h.fake.count()
	h.push.SendTo("u2", "Hello", "World", "tag-c") // no subs left: nothing sent
	if got := h.fake.count(); got != before {
		t.Fatalf("pruned sub received another send (%d -> %d)", before, got)
	}
}

func TestSendToKeepsSubOnOtherStatuses(t *testing.T) {
	h := newHarness(t)
	h.addUser(t, "u1", "boom")
	h.fake.setCode("/boom", http.StatusInternalServerError)

	h.push.SendTo("u1", "Hi", "there", "t")
	waitFor(t, "failed send attempt", func() bool { return h.fake.count() == 1 })

	subs, err := h.st.SubsByUser("u1")
	if err != nil {
		t.Fatalf("subs by user: %v", err)
	}
	if len(subs) != 1 {
		t.Fatalf("500 must not prune, %d subs remain", len(subs))
	}
}

func TestSendToPayloadShapeViaSenderSeam(t *testing.T) {
	h := newHarness(t)
	h.addUser(t, "u1", "seam-u1")
	h.fake.captureSeam(h.push)
	h.push.SendTo("u1", "Hello", "World", "tag-a")

	sends := h.fake.all()
	if len(sends) != 1 || sends[0].UserID != "u1" ||
		sends[0].Payload.Title != "Hello" || sends[0].Payload.Body != "World" || sends[0].Payload.Tag != "tag-a" {
		t.Fatalf("unexpected seam capture: %+v", sends)
	}
}

// ---------- rest timers ----------

func TestScheduleRestTimerFiresAndReplacesPerUser(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newHarness(t)
		h.addUser(t, "u1", "seam-u1")
		h.addUser(t, "u2", "seam-u2")
		h.fake.captureSeam(h.push)

		// Two schedules for u1 back to back: only the second may fire.
		h.push.ScheduleRestTimer("u1", 1)
		h.push.ScheduleRestTimer("u1", 1)
		h.push.ScheduleRestTimer("u2", 1)
		synctest.Sleep(2 * time.Second)

		rest := 0
		for _, s := range h.fake.all() {
			if s.Payload.Tag != "rest-timer" {
				continue
			}
			rest++
			if s.Payload.Title != "Rest over 💪" || s.Payload.Body != "Time for your next set." {
				t.Fatalf("unexpected rest payload: %+v", s.Payload)
			}
		}
		if rest != 2 {
			t.Fatalf("expected exactly 2 rest-timer sends (one per user), got %d", rest)
		}
	})
}

func TestCancelRestTimerPreventsFire(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newHarness(t)
		h.addUser(t, "u1", "seam-u1")
		h.fake.captureSeam(h.push)

		h.push.ScheduleRestTimer("u1", 1)
		h.push.CancelRestTimer("u1")
		synctest.Sleep(2 * time.Second)

		if got := h.fake.count(); got != 0 {
			t.Fatalf("cancelled timer fired anyway: %d sends", got)
		}
	})
}

// ---------- reminder loop ----------

func fixedNow(date, hhmm string, ok bool) func(string) (string, string, bool) {
	return func(string) (string, string, bool) { return date, hhmm, ok }
}

func TestReminderLoopFiresOncePerDayWithInjectedNow(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		oldInterval := reminderInterval
		reminderInterval = 15 * time.Millisecond
		defer func() { reminderInterval = oldInterval }()

		h := newHarness(t)
		h.addUser(t, "u1", "seam-u1")
		h.fake.captureSeam(h.push)
		h.writeState(t, "u1", reminderStateDoc("07:30"))

		// 2026-08-24 is a Monday: week[1] = "push", so the reminder fires. The
		// clock lives behind an atomic pointer so the running loop sees advances.
		var clock atomic.Pointer[func(string) (string, string, bool)]
		setClock := func(date, hhmm string) {
			f := fixedNow(date, hhmm, true)
			clock.Store(&f)
		}
		nowFn := func(tz string) (string, string, bool) { return (*clock.Load())(tz) }
		base := fixedNow("2026-08-24", "07:30", true)
		clock.Store(&base)

		ctx, cancel := context.WithCancel(t.Context())
		go h.push.RunReminderLoop(ctx, nowFn)
		synctest.Sleep(reminderInterval)

		if n := countTag(h.fake.all(), "day-reminder"); n != 1 {
			t.Fatalf("expected first day reminder, got %d", n)
		}

		// Several more ticks on the same local day: dedupe via users.last_reminder.
		synctest.Sleep(100 * time.Millisecond)
		if n := countTag(h.fake.all(), "day-reminder"); n != 1 {
			t.Fatalf("expected exactly one day reminder after repeated ticks, got %d", n)
		}

		u, err := h.st.UserByID("u1")
		if err != nil || u == nil {
			t.Fatalf("user load: %v %+v", err, u)
		}
		if u.LastReminder != "2026-08-24" {
			t.Fatalf("last_reminder = %q, want 2026-08-24", u.LastReminder)
		}

		// Next local day (Tuesday, week[2]="legs") fires again, exactly once.
		setClock("2026-08-25", "07:30")
		synctest.Sleep(reminderInterval)
		if n := countTag(h.fake.all(), "day-reminder"); n != 2 {
			t.Fatalf("expected second day reminder, got %d total", n)
		}
		synctest.Sleep(60 * time.Millisecond)
		if n := countTag(h.fake.all(), "day-reminder"); n != 2 {
			t.Fatalf("expected 2 total day reminders, got %d", n)
		}

		sends := h.fake.all()
		first, last := sends[0], sends[len(sends)-1]
		if first.Payload.Title != "Push Day today" || first.Payload.Body != "It's on your plan — let's go 💪" {
			t.Fatalf("unexpected first reminder payload: %+v", first.Payload)
		}
		if last.Payload.Title != "Leg Day today" || last.Payload.Body != "It's on your plan — let's go 💪" {
			t.Fatalf("unexpected second reminder payload: %+v", last.Payload)
		}

		cancel()
		synctest.Wait()
	})
}

func TestReminderLoopSkipsWhenNothingPlanned(t *testing.T) {
	cases := []struct {
		name   string
		state  map[string]any
		date   string
		hhmm   string
		ok     bool
		subbed bool
	}{
		{
			name:  "no subscription",
			state: reminderStateDoc("07:30"),
			date:  "2026-08-24", hhmm: "07:30", ok: true, subbed: false,
		},
		{
			name: "reminder off",
			state: func() map[string]any {
				d := reminderStateDoc("07:30")
				d["reminder"].(map[string]any)["on"] = false
				return d
			}(),
			date: "2026-08-24", hhmm: "07:30", ok: true, subbed: true,
		},
		{
			name:  "time mismatch",
			state: reminderStateDoc("07:30"),
			date:  "2026-08-24", hhmm: "09:00", ok: true, subbed: true,
		},
		{
			name:  "unknown timezone",
			state: reminderStateDoc("07:30"),
			date:  "2026-08-24", hhmm: "07:30", ok: false, subbed: true,
		},
		{
			name:  "already reminded today",
			state: reminderStateDoc("07:30"),
			date:  "2026-08-24", hhmm: "07:30", ok: true, subbed: true,
		},
		{
			name: "workout already logged today",
			state: func() map[string]any {
				d := reminderStateDoc("07:30")
				d["workouts"] = []map[string]any{{"d": "2026-08-24", "routineId": "push"}}
				return d
			}(),
			date: "2026-08-24", hhmm: "07:30", ok: true, subbed: true,
		},
		{
			name: "dayPlan rest override",
			state: func() map[string]any {
				d := reminderStateDoc("07:30")
				d["dayPlan"] = training.DayPlanMap{"2026-08-24": {Rest: true}}
				return d
			}(),
			date: "2026-08-24", hhmm: "07:30", ok: true, subbed: true,
		},
		{
			name: "week slot empty",
			state: func() map[string]any {
				d := reminderStateDoc("07:30")
				d["week"] = training.WeekSchedule{}
				return d
			}(),
			date: "2026-08-26", hhmm: "07:30", ok: true, subbed: true,
		},
	}

	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t)
			uid := fmt.Sprintf("user-%d", i)
			if tc.subbed {
				h.addUser(t, uid, uid+"/sub")
			} else {
				h.addUser(t, uid, "")
			}
			if tc.name == "already reminded today" {
				if err := h.st.SetLastReminder(uid, tc.date); err != nil {
					t.Fatalf("set last reminder: %v", err)
				}
			}
			h.writeState(t, uid, tc.state)

			h.push.reminderTick(fixedNow(tc.date, tc.hhmm, tc.ok))

			if got := h.fake.count(); got != 0 {
				t.Fatalf("case %q fired a reminder, want none (%+v)", tc.name, h.fake.all())
			}
		})
	}
}

func TestReminderDayPlanOverrideWinsOverWeek(t *testing.T) {
	doc := reminderStateDoc("07:30")
	doc["dayPlan"] = map[string]any{"2026-08-25": map[string]any{"sessions": []any{map[string]any{"routineId": "legs"}}}}
	raw, _ := json.Marshal(doc)
	s, err := decodeReminderState(raw)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	if got := effectiveRoutineId(&s, "2026-08-25"); got != "legs" {
		t.Fatalf("override = %q, want legs", got)
	}
	// Unknown override id falls through to the week grid.
	s.DayPlan["2026-08-25"] = training.MCPDayPlan{Sessions: []training.MCPDaySession{{RoutineID: "ghost"}}}
	if got := effectiveRoutineId(&s, "2026-08-25"); got != "legs" {
		t.Fatalf("ghost override = %q, want week fallback legs", got)
	}
	// 'rest' always means nothing planned.
	s.DayPlan["2026-08-25"] = training.MCPDayPlan{Rest: true}
	if got := effectiveRoutineId(&s, "2026-08-25"); got != "" {
		t.Fatalf("rest override = %q, want empty", got)
	}
	// JS getDay(): Sunday = 0. The current object-shaped state omits rest days;
	// Monday is keyed by "1".
	if got := effectiveRoutineId(&s, "2026-08-23"); got != "" {
		t.Fatalf("sunday = %q, want no routine", got)
	}
	if got := effectiveRoutineId(&s, "2026-08-24"); got != "push" {
		t.Fatalf("monday = %q, want week[1]=push", got)
	}
	// A sparse object-shaped week grid still indexes by weekday.
	s.DayPlan = nil
	s.Week = map[string][]training.MCPDaySession{"0": {{RoutineID: "mystery"}}}
	if got := effectiveRoutineId(&s, "2026-08-23"); got != "mystery" {
		t.Fatalf("sparse fallback = %q, want mystery", got)
	}
}

func TestReminderUnknownRoutineUsesFallbackTitle(t *testing.T) {
	h := newHarness(t)
	h.addUser(t, "u1", "seam-u1")
	h.fake.captureSeam(h.push)

	doc := reminderStateDoc("07:30")
	doc["routines"] = []map[string]any{} // rid resolves via week but has no routine entry
	h.writeState(t, "u1", doc)

	h.push.reminderTick(fixedNow("2026-08-24", "07:30", true)) // Monday → week[1]="push"

	sends := h.fake.all()
	if len(sends) != 1 {
		t.Fatalf("want exactly one reminder, got %d", len(sends))
	}
	if sends[0].Payload.Title != "Workout planned today" {
		t.Fatalf("fallback title = %q", sends[0].Payload.Title)
	}
}

func TestReminderKeepsRemainingSessionsAndHonorsEmptyOverride(t *testing.T) {
	for _, tc := range []struct {
		name     string
		plan     any
		workouts []map[string]any
		want     string
	}{
		{"second routine remains", nil, []map[string]any{{"d": "2026-08-24", "routineId": "push"}}, "legs"},
		{"all complete", nil, []map[string]any{{"d": "2026-08-24", "routineId": "push"}, {"d": "2026-08-24", "routineId": "legs"}}, ""},
		{"empty override", map[string]any{"sessions": []any{}}, nil, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			doc := reminderStateDoc("07:30")
			doc["week"] = training.WeekSchedule{"1": {{RoutineID: "push"}, {RoutineID: "legs"}}}
			doc["workouts"] = tc.workouts
			if tc.plan != nil {
				doc["dayPlan"] = map[string]any{"2026-08-24": tc.plan}
			}
			raw, _ := json.Marshal(doc)
			state, err := decodeReminderState(raw)
			if err != nil {
				t.Fatal(err)
			}
			if got := effectiveRoutineId(&state, "2026-08-24"); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

// A fired AfterFunc cannot be stopped, but cancellation/replacement must
// still invalidate its callback while it waits to acquire the service lock.
func TestRestTimerDiscardsStaleCallback(t *testing.T) {
	for _, replace := range []bool{false, true} {
		t.Run(fmt.Sprint(replace), func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				h := newHarness(t)
				h.addUser(t, "u1", "seam-u1")
				h.fake.captureSeam(h.push)
				h.push.ScheduleRestTimer("u1", 1)
				h.push.mu.Lock()
				// time.Sleep uses the bubble clock without synctest.Sleep's
				// implicit Wait, which would wait on our locked callback.
				time.Sleep(time.Second)
				var replacement *time.Timer
				if replace {
					replacement = time.NewTimer(time.Hour)
					defer replacement.Stop()
					h.push.timers["u1"] = replacement
				} else {
					delete(h.push.timers, "u1")
				}
				h.push.mu.Unlock()
				synctest.Wait()
				if got := h.fake.count(); got != 0 {
					t.Fatalf("stale timer delivered %d alerts", got)
				}
				h.push.mu.Lock()
				got := h.push.timers["u1"]
				h.push.mu.Unlock()
				if got != replacement {
					t.Fatal("stale callback removed replacement timer")
				}
				h.push.CancelRestTimer("u1")
			})
		})
	}
}
