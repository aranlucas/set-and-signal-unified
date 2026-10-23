# Implementation notes

## Boundaries

- `src/domain/workout.ts`: pure 5×5 state transitions, progression, timers, unit conversion, plates, warmups and weekly counters.
- `src/domain/backup.ts`: versioned, bounded JSON validation before any restore writes.
- `src/domain/csv.ts`: readable CSV, quoted values and neutralized spreadsheet formulas in text notes.
- `src/data/storage.ts`: SQLite WAL storage and atomic transactions.
- `src/data/store.ts`: a lazily loaded module snapshot, subscribed to through `useSyncExternalStore` and narrow `useAppState` selectors. Commits save to storage before publishing once to listeners. Identity no-ops do not save or notify. A failed write retains the previous visible state and reports the error. A read/validation failure never replaces the stored database with defaults; Retry reloads storage.
- `src/domain/commands.ts`: pure state transitions; time-dependent commands receive `now` as an argument rather than reading the clock.
- `src/data/actions.ts`: stable event actions that own side effects. Actions read the clock, pass `now` to commands, commit state changes, and handle native permission, haptic, import/export and error-notice flows.
- `src/shell/`: navigation/dialog state, focused app bar/navigation/dialog components, and external-system synchronization. Android Back is registered once with an Effect Event reading current navigation. Snackbar messages go directly to the mounted host.
- `src/shell/ExternalSync.tsx`: narrow store subscriptions and effects synchronize rest alerts, the home-screen widget, the ongoing workout notification, and keep-awake state with native systems.
- `src/domain/format.ts`: each default-locale Intl formatter is constructed lazily on first use and cached for the process lifetime. Cached formatters keep the locale they were created with until the app restarts. `src/domain/calendar.ts` owns local Monday boundaries shared by weekly summaries and the strip.
- `src/data/notifications.ts`: serialized cancellation/scheduling with a fixed rest-notification identifier.
- `src/domain/surfaces.ts`: pure props for the home-screen widget and the ongoing workout notification.
- `src/data/surfaces.ts` and `src/widgets/`: `expo-widgets` layouts (Glance-rendered Expo UI subset) and their sync. The widget mirrors the next or active workout; the silent ongoing notification mirrors the active workout while workout notifications are enabled. Neither is a source of truth, and widget taps do not open the app (expo-widgets 58 only broadcasts widget clicks).
- `src/data/exports.ts`: native folder selection, file writes, share sheet and restore picker.
- `src/screens` and `src/components`: Expo UI Compose controls, Material colors and typography. No third-party UI kit or web view.

## Persistence

Database `fivefold.db` has `user_version = 1`, an `app_state` row containing small settings/plan/active-workout state, and a `workouts` table containing completed sessions ordered by finish time. Logging a set writes only the small state row. Finalization stores the new workout and next plans in the same transaction. History deletion and a complete backup replacement are also transactional. The storage layer can read the initial whole-state prototype format and migrates its history on the next successful save.

Native state is saved on each set, weight change, setting and note edit; no background JS task is required to keep it. The in-memory history is loaded on startup, while UI history rows use SDK 58's native `LazyColumn.Items` recycling. Database contents are not encrypted. Android automatic cloud backup is disabled; JSON exports are user-selected plaintext files. No credentials are stored.

## Plate inventory and load guidance

`Settings.plates` is `null` for Standard gym (the default for new installs and old saved states/backups). Otherwise `PlateInventory` stores available **pairs** as integer counts from 0–20, aligned with the exported `KG_PLATES` `[25, 20, 15, 10, 5, 2.5, 1.25]` and `LB_PLATES` `[45, 35, 25, 10, 5, 2.5]` lists in `src/domain/plates.ts`. Both inventories persist in SQLite's small settings row and JSON backups; changing units preserves both arrays. CSV remains a workout log. Validation normalises a missing field without copying history, preserving the storage identity contract.

Pure commands set/toggle inventory and clamp individual pair steps; stable actions commit those transitions. Enabling counting starts with four pairs of each size in both units. The current-unit editor uses the same whole-row setting switch and native sheet as other equipment settings.

`loadPlates(target, bar, unit, inventory)` preserves `plateLoad`'s exact breakdown/remainder/below-bar behavior for `null`. With an inventory it solves a bounded minimum-plate integer problem per side, starting in 0.25 kg / 0.5 lb ticks and compressing their common denomination factor of five. Each denomination uses residue-class sliding minima in a dynamic program over the full inventory capacity; reconstruction retains the selected count for every denomination and amount. Time and reconstruction space are O(D × C), where D is the number of denominations and C is the per-side capacity in compressed ticks (at most 1,260 for kg or 980 for lb). No cross-call cache is required.

The result includes the chosen per-side breakdown, loaded total, remainder, below-bar and exact flags, and `below`/`above` options with their own minimum-plate breakdowns. Options are inclusive for an exact target; otherwise they are the nearest reachable totals on each side. Below is null below the bar; above is null beyond inventory capacity. Equal-count combinations use a deterministic tie-break favouring fewer plates of the later denomination. Below-bar guidance keeps the lighter-bar message. Tools expose alternatives without changing planned/logged weight. Active cards subscribe to the specific exercise, unit, inventory and relevant bar primitive; unrelated settings do not invoke them.

Exhaustive small-inventory oracles and legacy compatibility ranges cover correctness. `check-performance.ts` gates a fresh maximum-inventory solve at 2,000 kg (20 pairs of every size) at **p95 CPU < 1 ms** in Node. Render snapshots include a saved plate step and impossible-load tools flow; these are development-machine measurements, with installed-device and 200% font-scale verification still pending.

## Timer rules

A new set starts an absolute deadline. Correcting that same set from success to a miss upgrades its rest to the missed-rep duration; repeated correction does not restart it. Editing an older set leaves the current timer alone. Clearing the matching set cancels its timer. App foreground/restart computes time from the saved deadline. +30 seconds is capped at an hour. Finish/discard cancels rest. Notifications are optional. They use `setAlarmClock()` (`delivery: "alarmClock"` with `USE_EXACT_ALARM`), so Doze and OEM battery savers do not defer them; without exact-alarm access Android falls back to best-effort delivery. The in-app clock stays authoritative.

## History and progression policy

Completion advances A/B once. Successful lifts add one configured increment. A fully logged failure adds one miss and can deload after the third miss. Skipped sets do not count as another failure. Deloads do not go below the selected bar weight. Manual weight editing resets that lift's miss streak. History is a record of saved sessions; deleting a record does not reverse or replay progression. Unit changes are blocked during an active workout and round future weights to common equipment increments. Completed history retains original units and is converted only for aggregate display.

## Current limits

Fixed classic A/B program, one weight per exercise per session, standard plate denominations with optional pair inventory, suggested rather than editable/logged warmups, no bodyweight tracking, cloud synchronization, wearables, widgets, arbitrary routine builder, or iOS implementation. JSON restore replaces device data after a native confirmation and validates the complete incoming state first. Export before restoring if you need to retain current data.
