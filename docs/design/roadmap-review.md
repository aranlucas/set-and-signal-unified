# Roadmap release review

## Source review

The 1.2 implementation received independent reviews covering persisted-state validation, single-pass bounded progress aggregation, cache invalidation, weekly calendar refresh, history filtering, and finish-preview explanations. Two findings were corrected: the longer finish dialog body now scrolls independently of its actions, and calendar refresh schedules future clock-clamped completions as well as midnight and foreground refreshes. The follow-up source review found both resolved.

After restarting from `origin/main` (`60c7013`), Android 15 testing reproduced a system Back failure. An independent review of the 1.2.1 Expo configuration fix and E2E changes found no actionable issues. The change disables the predictive-back opt-in, preserves existing JavaScript navigation, and adds a test that fails against the 1.2 APK. The reviewer verified that compact-phone helper changes retain assertions and bounded gestures.

## Incremental navigation audit

PR #7 (`5357e08`) received a scoped Impeccable native technical review with verdict **SHIP** and no actionable source findings. The four-file patch uses Expo’s documented predictive-Back opt-out to restore Android 15 navigation, adds no runtime dependencies or render work, and covers all secondary tabs. An isolated archive of that commit passed lint, TypeScript, all 130 unit tests, and the CPU performance gate. This approval covers navigation compatibility only; it does not imply complete visual, accessibility, adaptivity, or physical-device performance approval.

## Impeccable finish review

Independent review verdict: **`disposition: ship`**, with no material fixes.

The reviewer opened all 14 signed-release phone captures and verified their dimensions and checksums against [the capture manifest](../../artifacts/roadmap/after/captures.json). Light/dark appearance, 150% system text, and portrait/landscape finish dialogs preserve the incumbent Material 3 design. The four-week count explanation, best versus latest lift outcomes, and All/B selection remain legible. The landscape dialog captures demonstrate a scrolling explanation body with Cancel and Save continuously visible.

This is a preservation-only extension governed by `PRODUCT.md`, `DESIGN.md`, and the roadmap design brief. No replacement visual world, concept seed, comp, or quality-bar card was commissioned. No web/CSS detector applies to native Compose rendering.

The visual verdict does not verify TalkBack traversal/announcements, measured contrast or touch bounds, reduced-motion behavior, or physical-device startup/frame/memory performance. Those limitations remain explicit; the review did not claim the in-progress device suite was green.

Keep the data-first hierarchy, explicit next-load reasons, All/A/B filtering, semantic light/dark palette, and scalable dialog body with fixed actions.

## E2E increment source review

The six compact-phone E2E files received an independent review against `cf3588e`: **clean, no actionable findings**. The A/B split retains the original actions and all 26 assertions inside one ordered serial session. The Deadlift selector targets the labelled selection control. Gestures remain bounded and end in assertions; no timeout increases, retries, skipped tests, or assertion-removal paths were introduced.

The subsequent full run passed 34 of 35 scenarios and exposed one more offscreen caption in the final workout-A assertion. The parent verified `WorkoutScreen.tsx` still renders the expected date and logged-set count; the fix scrolls to that same locator before the unchanged visibility assertion. It adds no sleep, retry, timeout, or product change.

Final device gate: all **35 installed-release E2E tests passed** on Android 15 in 330.40 seconds, with no failures, skips, flaky results, or interruptions. This completes the pending device check without changing the visually reviewed APK.
