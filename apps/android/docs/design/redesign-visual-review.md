# Fivefold redesign visual review

Reviewed 2026-10-22 from the supplied installed-APK captures in `artifacts/design/after/`, with the current review, competitor research, and source review as context. Scope: visual hierarchy, scanability, and obvious interaction clarity in the native Expo UI. These are screenshots of the installed APK, but the source review notes that Compose rendering and behavior were not validated against this checkout.

## Verdict

The redesign is a substantial improvement for the core 5×5 flow: the active workout leads with lift, load, set targets, previous result, and Finish; the rep editor identifies the value being corrected; the rest dock says which set is next; and history/settings use more compact, scannable rows. The light and dark workout screens remain consistent.

No release-blocking visual defect is established by these captures. There is one high-priority clarity issue in the workout set targets: the minus glyph used for an unlogged set can read as a failed/zero-rep result. Treating unlogged, zero reps, and partial reps as distinct states is central to the logging flow. Also recapture Progress after the current source change before using that screen as release evidence; the supplied Progress capture shows the older weekly strip and does not verify the compact weekly summary now in source.

## Findings, by priority

### P1 — Unlogged targets look like failed sets

**Observed —** `workout-dark.png` and `workout-light.png` render every unlogged, non-next target as a filled circle containing `−`. The rep editor in `rep-editor.png` separately offers `0 reps` as a valid logged result. The next target is clearly marked with `+`, but the other pending targets visually resemble a negative result rather than an untouched set.

**Recommendation —** Keep the numbered target row and next-set highlight, but give untouched targets an empty/pending treatment distinct from the logged zero-rep state. Keep partial and zero results explicit when logged. This is a visual state distinction within the existing design.

### P2 — Large type makes the persistent dock compete with detail content

**Observed —** In `history-detail-large-text.png`, the title and Resume action fit without collision, and two exercise cards are fully readable. The top of another card sits immediately behind the persistent Ready dock, so the visible page feels crowded at this text size. Content below the dock is not shown in this still.

**Recommendation —** Preserve the large type and verify that the detail/history scroll area has enough bottom inset to scroll the final exercise fully above the dock and navigation. The screenshot alone cannot establish whether all content is reachable.

### P2 — Progress capture is stale relative to current source

**Observed —** `progress-dark.png` spends a full row on seven day tiles and shows only four complete lift records before the persistent rest dock covers the next one. This capture predates the compact weekly-stat change.

**Source inference —** Current `ProgressScreen.tsx` starts with a compact weekly `StatRow` and maps all five lifts in the records panel. That should address the specific space loss in this capture, but without a new installed-APK screenshot it is not possible to assess the rendered result, record fit, or interaction with the dock.

**Recommendation —** Replace the stale Progress capture and confirm all five lift rows remain understandable with the rest dock visible. This is an evidence gap, not a confirmed defect in the current source.

### P3 — Rep editor has a small grammar inconsistency

**Observed —** `rep-editor.png` uses the singular lift/set title and a clear `Currently: 5 reps` status. The option for one rep reads `1 reps`, unlike the other choices.

**Recommendation —** Use `1 rep` for the singular option. This is minor polish and does not block logging.

## Screen-by-screen health

| Step | Capture | Health | Notes |
|---|---|---|---|
| 1 | [Active workout, dark](../../artifacts/design/after/workout-dark.png) | Good, with one P1 state-clarity issue | Finish, date, set progress, current load, previous result, and next set are visible. Two full lift cards fit above the dock. Unlogged `−` states may be mistaken for failures/zero. |
| 2 | [Active workout, light](../../artifacts/design/after/workout-light.png) | Good | Hierarchy and state colors carry over cleanly. Contrast and accessibility semantics were not measured. |
| 3 | [Rep editor](../../artifacts/design/after/rep-editor.png) | Good | Current value is stated and selected; Clear set is separated. Minor `1 reps` copy issue. Touch behavior and TalkBack were not tested. |
| 4 | [Settings, dark](../../artifacts/design/after/settings-dark.png) | Good | Grouped preference rows expose current values, with Resume and rest context still present. The footer copy occupies space but remains secondary. |
| 5 | [History list, dark](../../artifacts/design/after/history-dark.png) | Good | Two whole workout rows are scannable, with date, duration/completion, and lift summaries. Only a small data sample is visible; empty and long-name cases are not covered. |
| 6 | [Progress, dark](../../artifacts/design/after/progress-dark.png) | Needs a fresh capture | Older weekly tiles consume space; the bottom dock obscures part of the fifth record. Current source has changed this layout, so this screenshot is not representative evidence for that fix. |
| 7 | [Workout detail, large text](../../artifacts/design/after/history-detail-large-text.png) | Readable, crowded at the bottom | Header no longer collides; exercise names, loads, and rep targets remain legible. Confirm scroll reachability past the fixed dock. |

## Evidence limits

- Findings labeled **Observed** come from the seven supplied screenshots. The additional files `weight-history.png` and `weight-large-text.png` were not used.
- Source inferences are called out separately. The Progress implementation was inspected only to understand the stale capture; no build or native run was performed.
- Screenshots do not establish tap targets, scrolling, contrast ratios, screen-reader labels, timer accuracy, keyboard overlap, or whether the installed APK exactly matches the current source. Those need native interaction/accessibility checks.
- The competitor references in `competitor-ui.md` informed the intended native workout direction, but this review does not claim pixel parity with Strong, StrongLifts, or Hevy.
