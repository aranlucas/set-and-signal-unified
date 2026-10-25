# Fivefold 1.1.0 release verification

Release acceptance: **22 October 2026**. Signed standalone APK: `artifacts/Fivefold-1.1.0.apk` (76,946,992 bytes, about 77 MB). Android versionCode 2; same signing identity as 1.0.0.

SHA-256: `dcb9d9909dd88fb727b14f44c81abf944764cc8724cde12fcf9968c96939a7c9`.

## Redesign and review

The independent current-design audit, official competitor UI research, source regression review, screenshot review, and responses are in `docs/design/`. The competitor study inspected 16 official assets from StrongLifts, Strong, and Hevy; reference-only assets are not packaged in the APK. Impeccable and Product Design audit guidance informed the native design. The deterministic source detector returned an empty findings array; it does not measure Compose rendering, native contrast, or TalkBack.

Two full exercise sections remain visible with the rest dock on the Android 15 phone at default font scale. The Android 17 taller phone shows all three counter rows. All five progress records fit before detailed charts. The history alignment and current rep/next set context identified in review were confirmed in the installed release. Active pending counters use +; zero reps display 0/5. Readonly skipped sets use – with a legend.

## Automated checks

- ESLint: zero warnings; strict TypeScript compilation passed.
- 86 Vitest tests passed across four files. Covers workout transitions, per-lift progression/deloads, skipped versus zero reps, deadline correction, conversions/limits, plate/warmup calculations, week boundaries, backup validation, CSV escaping and real SQLite transaction behavior. Added records tests for mixed units, chronological unsuccessful/skipped history, and zero-weight versus absent records.
- Build passed minification/resource shrinking, v2/v3 APK signature verification, and 16 KB ZIP alignment. Hermes bundle and all four Android ABIs are embedded; no Metro/Expo Go dependency.
- Native dependency versions are unchanged from the 20/20 Expo Doctor check for 1.0.0: Expo SDK 58, RN 0.88.0, React 19.3.0, Expo UI 58.0.22. Package/config version is now 1.1.0.

## Installed release checks

- **Android 15 / API 35:** final APK passed the complete A → B → A replay, all 26 A/B work sets, deadlift 1×5, restart persistence, progression, history and progress. Correction explicitly traversed 3 reps, 0 reps, Clear, then 5. Structured result: `artifacts/qa-redesign/emulator-5556/smoke-result.json`.
- **Android 17 / API 37:** A/B replay passed during the redesign; final signed APK update then preserved its three workout logs, plans, settings and active workout. Final native checks covered rest context across tabs, history detail/back, all five records, 1-rep correction and Undo, ±increment adjustments, weight save and warmup/plate sheet. Evidence: `artifacts/design/android17-final-result.txt`.
- **Light/dark and large text:** native captures in `artifacts/design/after/`. At font scale 1.5 on Android 15, counters and rep editor remained usable; the last detail exercise and Back/Delete controls scrolled fully above the persistent dock. Selected 1 rep and Undo successfully. Font scale restored to 1.0.
- **Additional revised UI checks:** grouped rest and appearance sheets, native segmented choices and switches, quick weight adjustments, warmup/plates, and opening/dismissing the backup share sheet. Nothing was sent. Standard back returned from detail to history and from other tabs to Train.
- Current Android app/React Native error logs are empty on both emulators. Final build log: `artifacts/design/release-build.log`.

## Existing coverage and limits

The detailed 1.0.0 record remains in `docs/verification-1.0.0.md`. That release exercised native JSON folder export/restore, CSV export, notification permission denial/grant and background delivery, partial completion/notes, and fully offline release operation. Those data/export/notification modules were not changed by the redesign; the redesigned sharing entry and tools were re-exercised. This is not a claim that every prior manual scenario was rerun on 1.1.0.

No physical phone or full human TalkBack audit was performed. No iOS build is claimed. Predictive back opt-in remains disabled because the prior Android 15 test found it bypassed the JS handler; the standard back path is verified. Notifications remain subject to Android battery scheduling. Standard plate denominations assume enough pairs; there is no plate inventory manager.

The inherited upstream development-tool audit findings from 1.0.0 remain documented in its verification note. No dependencies were forced to older versions for this visual revision.
