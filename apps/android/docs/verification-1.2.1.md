# Fivefold 1.2.1 release verification

Verification date: 22 October 2026. Follow-up starts from `origin/main` commit `60c7013`, which includes the 1.2 roadmap release and the pnpm/EAS migration. Version 1.2.1 uses Android versionCode 4. Prior release evidence is preserved in [1.1.0 verification](verification-1.1.0.md).

## Navigation regression

The installed 1.2.0 EAS APK reproducibly returned to the Android launcher when system Back was pressed from Settings or saved workout details on Android 15. The new navigation E2E test also failed against that APK. Evidence: `artifacts/roadmap/verification/back-before.log`.

React Native 0.88 registers its AndroidX back callback only when both device and target SDK are at least 36 (`ReactActivity.java` and `AndroidVersion.kt` in the installed package). The app enabled predictive back on API 35, where its JavaScript `BackHandler` was bypassed. The correction sets Expo's `android.predictiveBackGestureEnabled` to `false`, preserving the existing navigation behavior. No custom native module or new runtime dependency is added. Expo documents the [configuration property](https://docs.expo.dev/versions/latest/config/app/#predictivebackgestureenabled); Android documents the [opt-out and callback behavior](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture#opt-out).

## Automated source and performance checks

`pnpm run check` passes lint with zero warnings, strict TypeScript, and **130 Vitest tests across eight files**. The 10,000-session development-machine benchmark measured **2.135 ms fresh-summary CPU p95** against a 16 ms budget and **0.101 ms for 1,000 cached calls** against an 8 ms budget. Fresh-summary wall p95 was 2.213 ms. This measures synchronous computation, not native startup or Android frame rate. Evidence: `artifacts/roadmap/verification/check.log`.

The E2E suite now contains 35 tests. Compact-phone helper corrections keep swipe paths inside workout content instead of the persistent rest dock and scroll offscreen assertions into view. Assertions remain in place. System Back is checked from all secondary tabs and from saved workout details.

The navigation correction merged separately in [PR #7](https://github.com/aranlucas/stronglifts/pull/7) (`cf3588e`). Its exact committed snapshot passed all 130 unit tests and the Android 15 navigation regression with main’s original helper (16.81 seconds). The scoped Impeccable native technical verdict was **SHIP**. Evidence: `back-isolated-check.log` and `back-isolated-navigation.log` in the verification artifact directory.

## Release and device gates

- Signed EAS local build: passed. APK `artifacts/Fivefold-1.2.1.apk`, versionCode 4, SHA-256 `37aa23f48f3bd94de38314d30d72b78f9fdc7237624608f49ebb5e7f2ef43571`. SDK 37 signature verification matches the existing signing certificate, 16 KB ZIP alignment passes, all four ABIs are present, and the app is non-debuggable. Evidence: `artifacts/roadmap/verification/build.log`.
- Android 17 installed release: all six insights scenarios and the navigation regression pass. Evidence: `artifacts/roadmap/verification/e2e-android17-insights.log` and `e2e-android17-back.log`.
- Android 15 installed release: **35 of 35 tests passed**, with zero failures, skips, flaky results, or interruptions, in **330.40 seconds**. The run used the same signed APK above and completed at 19:06:48 UTC. Evidence: `artifacts/roadmap/verification/e2e-android15-final-2.log`; run ID `01a164fd-27a4-717f-8569-53446bb78505`.
- Light/dark and enlarged-font captures: passed on the final signed APK. All 14 captures and their checksums are in `artifacts/roadmap/after/`; landscape at 150% text confirms dialog-body scrolling with fixed actions.
- Independent Impeccable finish review: **`disposition: ship`**, no material fixes. Scope and unverified accessibility/performance boundaries are in [the design review](design/roadmap-review.md).

Earlier runs are retained as diagnostic evidence: the initial run passed 28 of 34, with a combined A/B test reaching its 120-second budget and a Progress selector tapping a static heading. After splitting at the save boundary and selecting the labelled control, 34 of 35 passed; the remaining saved-workout caption was below the viewport. The final correction scrolls to that same caption before asserting it. All original behavioral assertions and the default per-test timeout remain. The complete final run passes on this corrected harness. Logs: `e2e-android15-initial.log`, `e2e-android15.log`, and `e2e-android15-final.log` in the verification artifact directory.

The compact-phone test and verification increment is [PR #8](https://github.com/aranlucas/stronglifts/pull/8). The emulator was returned to font scale 1.0, system light appearance, and its original rotation settings after verification.

## Scope and remaining work

The release includes All/A/B history filters, four local-calendar weeks, latest lift outcomes, next-load explanations, bounded cached progress aggregation, and durable storage boundary fixes. The [roadmap](roadmap.md) keeps measured physical-device profiling, asynchronous startup, expanded backup/restore E2E, explicit whole-exercise weight corrections, and coalesced note persistence in Next.

No physical-device frame/startup claims, complete human TalkBack audit, iOS build, or new backup/export round-trip verification are asserted here.
