# Implementation notes

## Boundaries

- `src/domain/workout.ts`: pure 5×5 state transitions, progression, timers, unit conversion, plates, warmups and weekly counters.
- `src/domain/backup.ts`: versioned, bounded JSON validation before any restore writes.
- `src/domain/csv.ts`: readable CSV, quoted values and neutralized spreadsheet formulas in text notes.
- `src/data/storage.ts`: SQLite WAL storage and atomic transactions.
- `src/data/useWorkoutStore.ts`: commits to storage before updating the visible state. A failed write retains the previous state and reports the error. A read/validation failure never replaces the stored database with defaults.
- `src/data/notifications.ts`: serialized cancellation/scheduling with a fixed rest-notification identifier.
- `src/domain/surfaces.ts`: pure props for the home-screen widget and the ongoing workout notification.
- `src/data/surfaces.ts` and `src/widgets/`: `expo-widgets` layouts (Glance-rendered Expo UI subset) and their sync. The widget mirrors the next or active workout; the silent ongoing notification mirrors the active workout while workout notifications are enabled. Neither is a source of truth, and widget taps do not open the app (expo-widgets 58 only broadcasts widget clicks).
- `src/data/exports.ts`: native folder selection, file writes, share sheet and restore picker.
- `src/screens` and `src/components`: Expo UI Compose controls, Material colors and typography. No third-party UI kit or web view.

## Persistence

Database `fivefold.db` has `user_version = 1`, an `app_state` row containing small settings/plan/active-workout state, and a `workouts` table containing completed sessions ordered by finish time. Logging a set writes only the small state row. Finalization stores the new workout and next plans in the same transaction. History deletion and a complete backup replacement are also transactional. The storage layer can read the initial whole-state prototype format and migrates its history on the next successful save.

Native state is saved on each set, weight change, setting and note edit; no background JS task is required to keep it. The in-memory history is loaded on startup, while UI history rows use SDK 58's native `LazyColumn.Items` recycling. Database contents are not encrypted. Android automatic cloud backup is disabled; JSON exports are user-selected plaintext files. No credentials are stored.

## Timer rules

A new set starts an absolute deadline. Correcting that same set from success to a miss upgrades its rest to the missed-rep duration; repeated correction does not restart it. Editing an older set leaves the current timer alone. Clearing the matching set cancels its timer. App foreground/restart computes time from the saved deadline. +30 seconds is capped at an hour. Finish/discard cancels rest. Notifications are optional. They use `setAlarmClock()` (`delivery: "alarmClock"` with `USE_EXACT_ALARM`), so Doze and OEM battery savers do not defer them; without exact-alarm access Android falls back to best-effort delivery. The in-app clock stays authoritative.

## History and progression policy

Completion advances A/B once. Successful lifts add one configured increment. A fully logged failure adds one miss and can deload after the third miss. Skipped sets do not count as another failure. Deloads do not go below the selected bar weight. Manual weight editing resets that lift's miss streak. History is a record of saved sessions; deleting a record does not reverse or replay progression. Unit changes are blocked during an active workout and round future weights to common equipment increments. Completed history retains original units and is converted only for aggregate display.

## Current limits

Fixed classic A/B program, one weight per exercise per session, standard plate denominations with unlimited-pair assumption, suggested rather than editable/logged warmups, no bodyweight tracking, cloud synchronization, wearables, widgets, arbitrary routine builder, or iOS implementation. JSON restore replaces device data after a native confirmation and validates the complete incoming state first. Export before restoring if you need to retain current data.
