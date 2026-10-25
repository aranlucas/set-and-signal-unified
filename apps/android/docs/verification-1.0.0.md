# Release verification

Release acceptance date: **2026-10-22**.

APK: `artifacts/Fivefold-1.0.0.apk` — 76,930,552 bytes (about 77 MB).

SHA-256: `75848862310f1e9116998b3ca896c651fbe39997c043f9a10e903dca8944c004`.

The final signed APK passed the Android 15 A → B → A smoke run, including all 26 work sets, restart recovery, deadlift 1×5, progression, history, progress and system back. Its structured result is `artifacts/qa/emulator-5556/smoke-result.json`.

## Automated checks

- Strict TypeScript compilation.
- ESLint 10, TypeScript rules and React Hooks/Compiler guidance, with zero warnings.
- Prettier consistency.
- Expo Doctor: 20/20 checks.
- 83 Vitest tests: workout lifecycle, independent progression, deloads, skipped/zero reps, timer correction/deadlines, units and limits, warmups/plates, weekly counters, versioned backup validation, CSV escaping/formula handling, and actual SQLite transactions via a Node adapter for the native bridge.
- SQLite checks include rollback on failed finalization, persistence/reopen, history replacement/deletion, initial-format migration, and 1,000 saved workouts without rewriting their rows on a set tap.

## Device acceptance

Two installed Android release targets: Android 17/API 37 (Agents_Android_17_API_37_2) and Android 15/API 35 (Pixel_API_35). Metro is stopped. `android-smoke.ts` records full A/B logging, deadlift 1×5, active-session restart, history detail, progress and the next A workout. Screenshots and structured reports live in `artifacts/qa/`.

Additional checks cover native weight input and validation, warm-up/plate tools, notification permission denial/grant, background timer delivery, native file save/restore, share sheet, theme changes, enlarged text, offline use, and back navigation. The final results below distinguish exercised behavior from limitations.

## Final acceptance results

- **Android 15:** final APK passed A → B → A, all 26 work sets across A/B, active-session close/reopen recovery, deadlift 1×5, next weights, history detail, progress and system back. At 1.5× font scale the counters remained readable and tappable; tab labels fit after applying Material label typography. Forced dark mode, including status-bar contrast, is verified. Font scale was restored to 1.0.
- **Android 17:** weight validation and 60 kg editing, warmup/plates, notification permission denial/grant, real background rest notification, JSON folder export and validation, discarding then restoring the active 60 kg/5-rep workout, notes, partial completion, 15-row CSV and native share-sheet opening all passed. Nothing was sent from the share sheet. The final APK installed as an update with history/settings preserved and launched/logged a set in airplane mode with Wi-Fi disabled and Metro stopped. Connectivity was restored afterward.
- **Evidence:** `artifacts/qa/emulator-5556/smoke-result.json`, `artifacts/qa/emulator-5554/manual-result.json`, exported JSON/CSV validation, notification dump, screenshots, build log and empty app error logs. The APK was verified with v2/v3 signatures and the 16 KB ZIP-alignment check.

## Build and signing

The APK is a minified/resource-shrunk release with an embedded Hermes bundle and no Metro/Expo Go dependency. The build script verifies APK signatures and 16 KB ZIP alignment. The release signing identity is private and kept outside the repo. `artifacts/build-info.json` and `artifacts/Fivefold-1.0.0.apk.sha256` identify the exact file.

## Findings and limits

- Device testing caught and fixed explicit native `Text` requirements inside buttons, persistent rest correction behavior, retained home-screen scroll on starting a workout, and input-limit/backup invariants.
- Predictive back opt-in is disabled after the installed Android 15 test showed a back action bypassing the JS navigation handler after a close/reopen cycle. The standard RN back path is tested instead. [RN BackHandler](https://reactnative.dev/docs/backhandler), [Android predictive-back opt-out](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture).
- Background notification delivery is best effort and remains subject to Android battery restrictions. The on-screen timer uses the saved absolute deadline.
- No physical phone or iOS build was tested. Semantic set labels and enlarged fonts are checked; this is not a claim of a complete human TalkBack audit.
- The calculator assumes standard plates with enough pairs; it reports impossible loads and lighter-than-bar targets but has no inventory manager.
- `npm audit` reports 15 inherited high-severity entries that trace to two upstream development-tool dependencies: `braces@3.0.3` (glob-pattern recursion) and `node-forge@1.4.0` (RSA verification). Both remain the latest published versions when checked. They are used by Metro/Expo CLI tooling, not by the app's workout runtime; no unsafe forced downgrade of Expo/RN was applied. Recheck before distribution in another environment. [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
