# Phase 2 implementation report

Compiler: 40 components/hooks compiled, 0 bailouts; allowlist empty. Existing widget-runtime layouts retain their separate runtime handling. Required render outcomes: set taps −42.9%, note keystroke −90%, rest tick unchanged. Startup hydration did not regress in the final run.

| Scenario | Total before → after | Top components before | Top components after |
|---|---:|---|---|
| start-workout | 19 → 25 | Caption ×8, Panel ×3, SetCounters ×3, App ×1 | Caption ×8, ExerciseCard ×3, Panel ×3, SetCounters ×3 |
| log-set | 21 → 12 | Caption ×8, Panel ×3, SetCounters ×3, Divider ×2 | AppBar ×1, AppShell ×1, Caption ×1, Divider ×1 |
| log-second-set | 21 → 12 | Caption ×8, Panel ×3, SetCounters ×3, RestTimer ×2 | RestTimer ×2, AppBar ×1, AppShell ×1, Caption ×1 |
| note-keystroke | 20 → 2 | Caption ×8, Panel ×3, SetCounters ×3, App ×1 | Field ×1, WorkoutNotes ×1 |
| rest-tick | 1 → 1 | RestTimer ×1 | RestTimer ×1 |
| tab-history | 40,004 → 40,007 | Caption ×10,001, Divider ×10,000, Panel ×10,000, SectionTitle ×10,000 | Caption ×10,001, Divider ×10,000, Panel ×10,000, SectionTitle ×10,000 |
| tab-progress | 90 → 93 | Caption ×45, SectionTitle ×14, Divider ×10, StatRow ×10 | Caption ×46, SectionTitle ×14, Divider ×10, StatRow ×10 |
| tab-settings | 10 → 12 | Divider ×4, Caption ×2, Application ×1, ListGroup ×1 | Divider ×4, Caption ×2, AppBar ×1, AppNavigation ×1 |
| tab-train | 18 → 25 | Caption ×8, Panel ×3, SetCounters ×3, Application ×1 | Caption ×8, ExerciseCard ×3, Panel ×3, SetCounters ×3 |
| open-weight-sheet | 24 → 8 | Caption ×8, Panel ×3, SetCounters ×3, Action ×2 | Action ×2, Field ×2, AppShell ×1, Caption ×1 |
| close-weight-sheet | 17 → 1 | Caption ×7, Panel ×3, SetCounters ×3, Application ×1 | AppShell ×1 |

Start-workout increases by 6 invocations: 8 new boundary/component invocations replace the former App/Application pair. Tab-train increases by 7 from AppBar/AppNavigation/AppShell replacing Application (+2), plus ActiveExercises, three ExerciseCards and WorkoutNotes (+5). Tab-history adds AppBar/AppNavigation/HistoryContent around the new shell (+3 net); the 10,000 row components are unchanged. Tab-settings adds 2 shell/navigation invocations. Tab-progress adds those same 2 plus one Caption invocation during the existing useToday refresh. These are component function invocation counts, including mounts; they are not native draw counts. The harness mock eagerly renders all history rows; production still uses native recycled LazyColumn.Items.

| CPU scenario | Before p50 / p95 (ms) | After p50 / p95 (ms) |
|---|---:|---:|
| setTapPipeline | 0.044 / 0.054 | 0.007 / 0.013 |
| startupHydrate | 14.302 / 15.047 | 7.271 / 7.633 |
| formatting.current | 32.054 / 36.768 | 0.564 / 0.619 |
| formatting.cachedIntl (control) | 1.264 / 1.343 | 0.626 / 0.643 |

The existing auxiliary gates record only CPU p95 for a fresh summary and one CPU sample for 1,000 cached calls, so p50 values cannot be reported for those. Cold summary CPU p95: 2.053 → 0.937 ms (budget 16 ms). Cached 1,000 calls: 0.119 → 0.066 ms (budget 8 ms).

The same development-machine fixture has 10,000 saved sessions (darwin/arm64, Node 24.22.1). Report-only scenarios use 200 measured iterations after 20 warmups. The revised setTapPipeline includes the pure update, small-state persistence serialization, widget and enabled-notification serialization, representative selectors, next-set context, and changed-exercise/header formatting. It excludes SQLite/native IPC and React rendering, which is measured separately. Formatting.current now calls the production cached formatters for 1,000 weights and 1,000 dates. The cachedIntl control is retained. Its own improvement indicates run-to-run machine/JIT variation; do not attribute all CPU differences to this refactor or extrapolate them to Android.

## Files changed in this implementation

- App.tsx; src/shell/{AppShell,AppBar,AppNavigation,DialogHost,ExternalSync}.tsx and src/shell/types.ts.
- New src/data/{store,actions,notices}.ts; removed src/data/useWorkoutStore.ts.
- New src/domain/{commands,format}.ts; updated src/domain/{workout,backup,calendar,progress,surfaces}.ts.
- src/screens/{WorkoutScreen,HistoryScreen,ProgressScreen,SettingsScreen}.tsx; src/components/{Sheets,WeekStrip}.tsx.
- New tests/{store.test.tsx,commands.test.ts,format.test.ts,app-events.test.tsx} and tests/support/progressOracle.ts; updated tests/{compiler.test.ts,renders.test.tsx,perf-instrumentation.test.ts,performance.test.ts,progress.test.ts} and tests/support/native.tsx.
- package.json, eslint.config.mjs, new .prettierignore, check-performance.ts, docs/architecture.md; .mcp.json received only required Prettier formatting.
- Measurement/report output in artifacts/perf/{cpu-after,renders-after,compiler-after}.json and phase2-report.{md,html}. Baseline/original JSON files were not edited. Existing Phase 1/design changes in all other dirty files were preserved.

## Validation

Passed: pnpm run check (lint, typecheck, Prettier, 16 Vitest files / 173 tests, CPU gates); FIVEFOLD_PERF_LABEL=after pnpm run perf; FIVEFOLD_PERF_LABEL=after pnpm run perf:renders; FIVEFOLD_PERF_LABEL=after pnpm exec vitest run tests/compiler.test.ts; git diff --check. The render snapshot was updated only after reviewing the new counts. The harness still renders the real App default export using the production compiler configuration.

## Device risk and deviations

No device e2e, Android build, Gradle, prebuild, adb or emulator was run, as requested. Native Compose callback/ref behavior, SnackbarHost delivery, Android Back ordering relative to native sheets, and notification scheduling remain unverified on a device. Node tests cover latest navigation state with one Back registration, repeated imperative notices, note expansion across discard/start, surface sync isolation, persistence failures/retry, commands, timer caps and undo. The TopAppBar key/remount expression, local RestTimer ticking and native LazyColumn.Items remain in place. No new runtime dependency or commit was added. No known functional deviation from the brief; increased mount counts and the revised CPU scenario are disclosed above.
