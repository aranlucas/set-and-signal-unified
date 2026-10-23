# Fivefold 1.3.0 release verification

Verification date: 23 October 2026. Source base: `e2e2455` (1.2.1) plus the 1.3.0 changes on `t3/react-performance-audit`. Version 1.3.0 uses Android versionCode 5. Earlier evidence is preserved in [1.2.1 verification](verification-1.2.1.md).

## Scope

- **My plates**: optional available-pair inventories for kg and lb, a minimum-plate bounded solver, closest below and above loads, a native editor, and a warning on the workout card when the planned weight cannot be loaded.
- **Units**: new installs default to pounds (45 lb bar; 45/45/65/45/90 lb loads; +5 lb, or +10 lb for deadlift). First-run setup offers a kg/lb choice. Existing installs keep their saved unit.
- **Layout**: fixes for 200% text, compact phones and tablets (centred column of at most 640 dp); portrait lock on phones; a 48 dp rest dock on the navigation surface. Before/after captures were reviewed on the emulator.
- **React architecture**: an external store with narrow subscriptions, pure commands, zero React Compiler bailouts, and lazily cached `Intl` formatters. The method and measurements are in the [React audit](react-audit.md).

## Automated checks

`pnpm run check` passes: ESLint with zero warnings (React Hooks `recommended-latest` on `.ts` and `.tsx`), strict TypeScript, Prettier, and **211 Vitest tests across 18 files**. The suite includes:

- the React Compiler gate (41 components and hooks compiled, no bailouts);
- render-count snapshots for 13 interactions;
- a strict Expo UI `Text` children check;
- CPU budgets.

The plate solver's worst case (2,000 kg target, 20 pairs of every size) measured 0.068 ms CPU p95 against a 1 ms budget.

## Release build

- Signed EAS local build, `artifacts/Fivefold-1.3.0.apk`: versionCode 5, 78,173,799 bytes, SHA-256 `a95f00372e31e16d2b859813315ac0f6f9e7df97e831c4652fedd04b261583c7`.
- The v2 signature verifies with certificate SHA-256 `aa7ad6eee903940e6867adaf2a0b0f2be466042ac00ecde27343f466e2cf321f`, the same certificate as 1.2.1, so it installs as an update.
- 16 KB ZIP alignment passes. All four ABIs are present, target SDK is 36, the APK is not debuggable, and phones are portrait-only.
- The Hermes bundle contains neither the measurement instrumentation (`FIVEFOLD_PERF`) nor the measurement seed code. The build ran from a cleared Metro cache.

## Installed-app E2E

Android 15 emulator, signed APK above: **36 of 36 tests passed** in 511.55 s, with zero failures, skips, flaky results or retries (run `01a16831-a0cc-7810-91af-ee5178d86fa1`). Log: `artifacts/release-1.3.0/e2e-android15.log`.

Earlier runs on the way to this result are kept as evidence:

- `e2e-android15-initial.log` (25 passed, 3 failed, 8 skipped): two tests still expected text the 1.3.0 changes had altered ("1 saved workouts", and Deadlift now below the fold in the equipment sheet). The new plates test asserted a disabled state on a label node. In Expo UI, the label and the disabled button are sibling nodes, so the test now checks the zero boundary by tapping once more.
- `e2e-android15-second.log` (35 passed, 1 failed): found a real regression. In Standard gym mode the Warm-up & plates caption rendered empty, because Expo UI `Text` drops Fragment children. The caption is now a single string. The render harness's `Text` mock now rejects unsupported children, so this class of bug fails in Node; the mock failed before the fix and passes after.

Captures from the signed APK are in `artifacts/release-1.3.0/`: first-run unit choice, the plate editor, the workout-card warning, and the closest-load options.

## Performance

Measured on the Android 15 emulator with 10,000 seeded sessions, using alternating release builds (see the [React audit](react-audit.md)):

- JS per set tap: 12.4 → 8.5 ms median; 60.2 → 23.0 ms p95.
- React render and reconcile: 7.0 → 3.3 ms median.
- Startup to first ready commit: 543 → 551 ms median, within noise.
- Memory: unchanged at about 120 MB PSS.

## Not verified

- Physical-device startup or frame pacing (emulator frame statistics are not meaningful).
- A full human TalkBack pass.
- Android 17.
- 200% text on the new plate editor.
- Backup/export round trips beyond the existing unit tests.
- iOS.

## How each check is re-run

These commands describe the repeatable gates; the recorded 1.3.0 results above
remain historical evidence. Device commands operate on disposable QA data.
See [installed-app E2E](e2e.md) for APK overrides, prerequisites and cleanup.

| Check | Command / source |
| --- | --- |
| Unit/domain/storage tests, strict native Text children | `pnpm test` (`tests/*.test.ts`, `tests/*.test.tsx`) |
| Lint, TypeScript, formatting and complete Node gate | `pnpm run check` |
| React Compiler, no bailouts | `pnpm exec vitest run tests/compiler.test.ts` |
| Render counts for interactions | `pnpm run perf:renders` (`tests/renders.test.tsx`) |
| CPU budgets, including worst-case bounded plate solver | `pnpm run perf` (`check-performance.ts`) |
| Device performance A/B, startup, JS/render times, memory | `node measure-device.mjs --serial emulator-5556 --apk <instrumented-apk> --label baseline` then repeat with `--label candidate` (see `docs/react-audit.md`; instrumented artifacts must not ship) |
| Installed-app workouts, settings, persistence, navigation, plates | `E2E_DEVICE=emulator-5556 pnpm run test:e2e` |
| Android 15 and 17 device matrix | `pnpm run test:e2e:matrix` (`e2e-matrix.mjs`; AVDs must not already be running) |
| Upgrade in place from latest signed release | `E2E_DEVICE=emulator-5556 pnpm exec e2e run tests/e2e/upgrade.e2e.ts` |
| Upgrade in place from 1.2.1 | `E2E_DEVICE=emulator-5556 FIVEFOLD_PREVIOUS_APK=artifacts/Fivefold-1.2.1.apk pnpm exec e2e run tests/e2e/upgrade.e2e.ts` |
| Legacy backup restore, custom inventory and byte-identical round trip | `E2E_DEVICE=emulator-5556 pnpm exec e2e run tests/e2e/backup.e2e.ts` |
| 200% text tabs, plate columns/cap, workout sets/warning and tools | `E2E_DEVICE=emulator-5556 pnpm exec e2e run tests/e2e/large-text.e2e.ts` |
| Accessible names and enabled 48 dp targets across app surfaces | `E2E_DEVICE=emulator-5556 pnpm exec e2e run tests/e2e/accessibility.e2e.ts` |
| Release signature, 16 KB alignment, metadata/ABIs/portrait, bundle and checksum | `pnpm run verify:apk` (`verify-apk.mjs`; `node verify-apk.mjs artifacts/Fivefold-1.3.0.apk` checks the historical artifact) |

Physical-device frame pacing and a human TalkBack experience still require
human/device evaluation; the deterministic accessibility audit codifies the
name, target-size and clipping checks, not spoken navigation behavior. No iOS
release target is configured.
