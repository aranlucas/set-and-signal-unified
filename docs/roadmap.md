# Fivefold roadmap

The next release strengthens the existing offline 5×5 loop: understand the last workout, know why the next load changes, and keep logging responsive as history grows. Android, Expo UI, the A/B routine, and durable local storage remain the product foundation.

## Release 1.2 — training clarity and durable growth

| Milestone | User outcome | Acceptance criteria | Status |
| --- | --- | --- | --- |
| Training insights | Find A or B sessions and understand recent consistency | Native All/A/B history filters, useful empty states, four local-calendar weeks, actual latest lift results | In progress |
| Progression clarity | Understand the next load before saving | Explain increases, skipped lifts, missed attempts, disabled automation, and deloads using the same calculation that saves plans | In progress |
| Reliable growth | Saved workouts remain readable as the log grows or the clock changes | Local database validation independent of backup import limits; rollback-clock regression; indexed history ordering | In progress |
| Performance gates | History growth does not multiply work on every set or tab interaction | One cached progress aggregation, at most 10 recent entries per lift, 10,000-session regression fixture, small current-state-only set writes | In progress |
| Device confidence | New behavior works in the installed release | Deterministic e2e coverage, original workout/recovery/settings regressions, Android release build, screenshots and verification record | Pending |

### Design brief

Mode: Operate. A lifter checks loads between sets and reviews progress after training. Extend the existing green Material 3 system using `@expo/ui`, native segmented controls, native lazy lists, readable type and 48 dp targets. Keep the current workout and lift records prominent. Use compact labels and explicit text for missed/skipped results; color alone must never carry meaning. Preserve light/dark appearance and Android font scaling. No new runtime libraries are needed for this release.

### Performance contract

- Set logging saves only current state; unchanged history must not be serialized or rewritten.
- Aggregate all lift records in one pass when history or units change. Keep all-time bests but retain only ten recent observations per lift; charts render eight.
- Cache derived progress by immutable history identity and unit. Selecting a lift must reuse the summary.
- History remains a native recycled `LazyColumn.Items` list, including filtered results.
- Timer ticks remain local to the timer and aligned to its absolute deadline.
- Add structural regression assertions and an explicit main-thread CPU benchmark (16 ms p95 fresh summary, 8 ms per 1,000 cached reads). Record wall time separately because concurrent builds can delay scheduling; desktop results are development guardrails, not claims of Android frame rate.
- Run `npm run check`, the performance command, and installed-app e2e tests before marking this release verified. Native startup/frame budgets require measurements, not assumptions.

## Next — measured device performance and data recovery

- Profile cold startup, set taps, and history scrolling in a release build with 10,000 sessions. Record device, OS, build, p50/p95, dropped frames, and memory. Establish hardware-specific budgets from those measurements.
- Move startup to asynchronous Expo SQLite reads with a visible loading/retry state, then page older history if measurements justify it.
- Add actual native backup/export/restore round trips and failed-save recovery e2e scenarios.
- Make whole-exercise weight corrections explicit once sets have been logged, with a preview of the affected results.
- Coalesce note writes only after a serialized writer proves finish/background/restart never loses a note.

## Later — useful training tools

- Configurable available plate pairs and lighter bars, with honest impossible-load guidance.
- Rest completion/background notification e2e coverage and permission recovery.
- Optional training-day preferences and local reminders through Expo Notifications.
- Evaluate iOS only after adapting the Compose-only UI to native Expo UI equivalents and proving the same data guarantees.

## Improvement loop

For each next slice: identify the user problem and evidence, write acceptance criteria, design within `DESIGN.md`, implement the smallest complete behavior, add regression coverage, measure performance, verify the release on a device, and update this roadmap with evidence. Keep speculative ideas in Next/Later until their scope is concrete. Do not mark unmeasured performance or unrun device checks complete.
