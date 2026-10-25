# Redesign acceptance

The initial and competitor reviews are in current-review.md and competitor-ui.md. Regression and visual reviews are in redesign-code-review.md and redesign-visual-review.md. The review documents are historical findings; this file records responses and final verification.

## Findings and responses

- Rep editor current value: shown in text and selected accent fill; verified by native correction through 3 reps, 0, Clear, and Undo.
- Upcoming set: shown throughout countdown and Ready; persists across tabs.
- Untouched-minus ambiguity: all active unlogged counters now show +; zero results show 0/5. Readonly skipped sets retain – with an explicit legend.
- History alignment: recycled row wrapper fills available width; titles/names take the remaining width before numeric values. Detail headings also wrap within remaining width.
- Progress overview: compact weekly count replaces the seven-day strip on Progress. The training home retains the calendar strip.
- Large type: preserve native scaling and scrolling; do not shrink text to force a fixed number of cards. Confirm the final lift and actions remain reachable above the rest dock.
- Singular rep: the one-rep editor option uses “1 rep”.

## Evidence

Before captures: artifacts/design/before. Installed-release after captures: artifacts/design/after. These contain synthetic QA workout logs. Source-reference screenshots are not included in the APK. Unit/lint/type checks and native QA are recorded in docs/verification.md and artifacts/qa-redesign.

Final confirmation: Android 15 dark Progress now shows all five records above the dock; final History rows align at full width. At 1.5× font scale, the final deadlift record and Back/Delete actions scroll fully into view above the dock; the 1-rep editor and Undo passed. Android 17 confirms the lighter theme, tools, quick weight changes and preserved data. Some immediate screenshots captured an outgoing native frame; final comparison captures were taken after an additional semantic snapshot or settled frame. No application error logs were emitted on either emulator.
