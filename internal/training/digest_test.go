package training

import (
	"testing"
	"time"
)

func TestTodayISOLocal(t *testing.T) {
	now := time.Date(2026, 8, 24, 1, 30, 0, 0, time.UTC)
	if got := TodayISO("America/Los_Angeles", now); got != "2026-08-23" {
		t.Fatalf("todayISOLocal = %q, want 2026-08-23", got)
	}
}

func TestWeekdayKey(t *testing.T) {
	for _, tc := range []struct{ date, want string }{
		{"2026-08-24", "1"},
		{"2026-08-23", "0"},
		{"2024-02-29", "4"},
		{"2026-03-08", "0"},
		{"not-a-date", "0"},
		{"2026-02-30", "0"},
	} {
		if got := weekdayKey(tc.date); got != tc.want {
			t.Errorf("weekdayKey(%q) = %q, want %q", tc.date, got, tc.want)
		}
	}
}
