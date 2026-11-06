package training

import (
	"fmt"
	"strconv"
	"time"
)

// TodayISO uses the given IANA timezone, falling back to UTC if unavailable.
func TodayISO(tz string, now time.Time) string {
	loc := time.UTC
	if tz != "" {
		if l, err := time.LoadLocation(tz); err == nil {
			loc = l
		}
	}
	t := now.In(loc)
	return fmt.Sprintf("%04d-%02d-%02d", t.Year(), int(t.Month()), t.Day())
}

// weekdayKey uses the calendar date independently of the server timezone.
func weekdayKey(iso string) string {
	t, err := time.Parse("2006-01-02", iso)
	if err != nil {
		return "0"
	}
	return strconv.Itoa(int(t.Weekday()))
}
