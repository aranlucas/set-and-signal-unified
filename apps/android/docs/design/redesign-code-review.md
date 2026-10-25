# Fivefold redesign code review

Reviewed 2026-10-22. Read-only inspection of `App.tsx`, `src/components`, `src/screens`, `src/domain/progress.ts`, and the design briefs in this directory. This is a source review only: no build, device, or native interaction was performed. Findings below are code-backed; Compose rendering, TalkBack output, and device behavior remain unverified.

## Findings

### P1 — Rep editor does not identify the value currently logged

In `WorkoutScreen`, tapping a logged set opens the exact-rep sheet, but the six rep options (5 through 0) are all rendered as identical `FilledTonalButton`s. The sheet does not display the current value or mark its matching option as selected. A lifter correcting a set therefore has to remember whether it was 5/5, 4/5, etc.; tapping an option to confirm or adjust can silently replace the logged value with another one. This weakens the core correction flow the redesign added.

**Recommendation:** Show the existing result in the sheet heading or helper text (for example, “Currently logged: 3 reps”) and give the matching option a selected treatment/semantics. Keep Clear set separate. Source: `src/screens/WorkoutScreen.tsx`, rep editor around lines 311–342.

### P1 — Rest dock omits the next-set context requested in the brief

The persisted `Rest` value contains both `lift` and `setIndex`, but `RestTimer` renders only the lift name and “rest” (or “Ready for your next set”). It never shows which set follows. This leaves the dock unable to answer the brief’s explicit in-workout question of what comes next, particularly after navigating to another tab or returning from the background. `setIndex` is available to derive that context.

**Recommendation:** Show the upcoming set number with the exercise during countdown and at Ready. For example, derive “Squat · next set 2” from `rest.lift` and `rest.setIndex`; handle the final set without suggesting another set. Source: `src/components/RestTimer.tsx` lines 64–72; `src/domain/workout.ts` lines 57–61.

## Original objections addressed in code

- The active workout has a compact top bar with Finish; start view leads with next workout, A/B switch, lift loads, and Start.
- Set targets are numbered, indicate the next unlogged set with `+`, use 48dp sizing, expose rep counts in accessibility descriptions, and offer an exact-rep editor plus Undo.
- Rest state is rendered outside the tab-specific screen, so it remains available across Train, History, Progress, and Settings while the app is open.
- History uses compact exercise rows and numbered rep cells; progress includes missed/skipped entries in its dated history list while calculating best only from fully completed prescriptions.
- Settings are grouped into bottom sheets, and save/restore notices use a snackbar host.

## Remaining brief gaps (lower priority)

- The proposed three primary destinations with Settings in an app-bar action became four bottom navigation destinations, including Settings. This is a direction mismatch, not a demonstrated functional regression.
- The rest dock is persistent across tabs, but the source does not establish actual Android background accuracy, notification delivery, or last-exercise reachability with the dock and navigation visible.
- The “two complete exercise sections with rest running,” large-text reflow, narrow-screen layout, snackbar timing, contrast, and screen-reader announcements require native verification; source inspection alone cannot establish them.

No P0 issue was established from the inspected source. Native QA may reveal additional layout or interaction issues.
