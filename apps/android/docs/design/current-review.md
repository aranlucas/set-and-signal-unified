# Fivefold Android design review

Reviewed 2026-10-22. Goal: start, log sets, rest, and understand the next load. Retain native `@expo/ui/jetpack-compose`. Strong, Hevy, and StrongLifts are the requested direction; their current screens were not audited.

Keep readable loads, large set targets, previous performance, native navigation, and the docked timer. The main weakness is hierarchy: slogans and spacious cards dominate workout data.

## Evidence and limits

Inspected the supplied screenshots with `view_image`:

1. [Active workout, light](../../artifacts/qa/emulator-5556/active-workout.png): usable counters; poor exercise visibility.
2. [Active workout, dark](../../artifacts/qa/emulator-5556/dark-workout.png): legible theme; persistent save notice further reduces space.
3. [History detail](../../artifacts/qa/emulator-5556/history-detail.png): clear loads; repeated rep text wraps and limits scanning.
4. [Progress](../../artifacts/qa/emulator-5556/progress.png): meaningful records; weak overview of lifts and trends.
5. [Settings, dark, scrolled](../../artifacts/qa/emulator-5556/dark-settings.png): recognizable switches; verbose, tall groups.

Read `App.tsx`, `src/components/ui.tsx`, all `src/screens/*`, and `RestTimer.tsx`. **Observed** means visible screenshot evidence; **code/inference** means implementation evidence or predicted risk. Home and history list lack screenshots. Live behavior, accessibility, timer accuracy, and screenshot equivalence to this checkout remain unverified.

## Five highest-impact changes, in order

### 1. P0 — Make the workout the first thing on screen

**Observed:** “One set at a time,” its eyebrow, and reassurance occupy substantial space. Only Squat is fully visible. Progress repeats this treatment. **Code/inference:** Home adds slogans and plan explanations. `Page`/`Panel` apply 20dp insets, 16dp gaps, and 20dp card padding throughout.

**Redesign:** Use a compact app bar: `Workout A`, `1/15 sets`, Finish. Exercise sections: name/editable load, prescription/previous result, then counters. Move cues and warm-up/plates into a native sheet. Home should lead with `Next · Workout A`, three exercise/load rows, and Start, followed by weekly count and recent session. Show setup education on first use.

Start with 16dp gutters, 12–16dp section padding, 8dp gaps, 18–20sp titles, and 24–28sp key numbers. Preserve font scaling. Target two complete exercise sections with rest running, without shrinking touch targets.

### 2. P0 — Give counters an obvious next set and safe correction

**Observed:** Five large circles are easy to tap, but all four unlogged circles look identical; none indicates the next set. **Code/inference:** Taps cycle `unlogged → 5 → 4 … → 0 → unlogged`. An accidental second tap changes a successful set into a missed rep; the explanatory text is below all exercises.

**Redesign:** Keep five counters; add set numbers, outline the next set, and mark completion. Label partial results `3/5` rather than relying on color. Tap empty to log five; tap logged to open a native 0–5/Clear editor. Provide Undo. Preserve 48dp minimum targets, descriptive accessibility labels, and large-text reflow. Give editable weights a visible edit affordance.

### 3. P1 — Make rest a compact, persistent part of the lifting flow

**Observed:** The timer is readable and has useful +30s/Skip controls, but its multi-line dock plus navigation consumes considerable vertical space. The dark workout and history detail also show an old save notice above the content. **Code/inference:** `App.tsx` renders rest only on Train; visiting Settings leaves Resume but no countdown. Notices persist until dismissed. Finish sits after all exercise cards.

**Redesign:** Use a compact native dock: `Rest 1:28`, `Squat · next set 2/5`, +30s, Skip, and a thin progress indicator. Expand for details. Keep a countdown/Resume strip on other tabs. At zero, show Ready with next-set context. Put Finish in the app bar; retain incomplete-session confirmation. Make save feedback transient and storage errors persistent. Verify the last exercise remains reachable above dock and keyboard.

### 4. P1 — Turn history and progress into scan-friendly records

**Observed:** History detail spells out `5 reps / 5 reps…`, wrapping the last result to another line; only two of three lifts fit. Progress puts a slogan and large weekly card above a single visible lift record. **Code/inference:** The history list repeats the hero/card structure and requires a separate Details button. Progress lists up to six successful sessions per lift and omits failed sessions from those entries.

**Redesign:** History: compact whole-row targets grouped by date, with workout, duration, sets, and lift summary. Detail: small date/duration/volume header, exercise/load rows, five numbered rep cells; distinguish skipped from zero. Move deletion to overflow. Progress: compact weekly summary and all five lifts showing best completed prescription, latest result, next load. Open a lift for dated results including misses, separate from successful-record calculations. Use an aligned list or Expo UI-native trend view; avoid WebView/chart dependencies and misleading 1RM labels.

### 5. P1 — Replace the universal card style with a restrained native system

**Observed:** Settings gives long explanatory copy, pill choices, and large headings almost equal emphasis; Appearance alone takes a large section. The same soft rounded container treatment repeats across unrelated screens. **Code/inference:** `Panel`, `Heading`, and `Choices` enforce this uniformity; settings also includes implementation-facing wallpaper-color copy.

**Redesign:** Group native preference rows: Training, Equipment, Rest & alerts, Appearance, Data. Use trailing values/switches and sheet editors; summarize rest as `1:30 / 3:00`. Use native segmented controls where supported, otherwise compact choices. Move explanations into editors and remove framework language. Reserve strong fills for primary actions, next set, and selection; use neutral surfaces/separators elsewhere. Align numbers and preserve distinct success/partial/skipped states across themes. Build with Expo UI Rows, Columns, Text, buttons, switches, sheets, and modifiers; verify installed component support.

Implementation order: active workout and counters first, then timer/navigation, then records and preferences. Recheck both themes, narrow widths, large fonts, correction/undo, partial completion, and background/resume behavior before judging the redesign complete.
