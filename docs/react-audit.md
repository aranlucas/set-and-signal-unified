# React audit and measured refactor

Audited 2026-10-22 against `e2e2455` (Fivefold 1.2.1): Expo SDK 58, React Native 0.88, React 19.3, React Compiler 1.0, Hermes V1, New Architecture. Every improvement below was measured before and after. Numbers that could not be measured reliably are labelled as such.

## Findings

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | P0 | The root `Application` component failed React Compiler compilation (`try/catch` around value blocks in the restore and alerts handlers). It owned all state and about 20 inline handlers, so every commit gave every screen new callbacks. | Async side effects moved to `src/data/actions.ts`. The compiler gate (`tests/compiler.test.ts`) now requires zero bailouts; 40 of 40 components and hooks compile. |
| 2 | P0 | A 584-line root mixed navigation, dialogs, notices, undo and inline state transitions. Transitions could only be tested on a device. | External store (`useSyncExternalStore`, save-before-publish), pure commands with `now` passed in, and a shell split into `src/shell/*`. |
| 3 | P1 | Screens received the whole `AppState`. A note keystroke invalidated every screen. | Narrow `useAppState` selectors. Exercise cards and notes subscribe to their own slices. |
| 4 | P1 | Widget and notification sync ran on every commit, including keystrokes. | `ExternalSync` re-syncs each surface only when the slices it displays change. |
| 5 | P1 | Event logic lived in effects: the snackbar was driven by state plus an effect, and Back was re-subscribed on every navigation change. | Imperative `notify()`. Back is registered once and reads the latest state through `useEffectEvent`. |
| 6 | P1 | `toLocaleString` and `toLocaleDateString` built a formatter on every call in render paths. On Android, Hermes routes `Intl` through JNI. | Cached formatters in `src/domain/format.ts`, created lazily (see the startup finding below). |
| 7 | P1 | React Hooks lint rules only covered `.tsx`, so hooks in `.ts` files were unchecked. | `recommended-latest` now applies to `.ts` and `.tsx`. Prettier runs as part of `check`. |
| 8 | P2 | Redundant manual memoization, imports at the bottom of files, a cross-screen helper import, test-only exports in `src`, four copies of the Monday-week calculation, and `any` in backup validation. | Removed or consolidated. |

Layout fixes from the same pass, each checked on the emulator before and after:

- **200% font**: navigation labels broke mid-word and set labels collided. Labels are now single-line, and counters use five equal columns with a 56 dp minimum.
- **Landscape phone**: only about 40 dp of the workout was visible. Phones are now portrait-only; Android 16 large screens ignore the lock.
- **Tablet**: cards stretched across the whole screen. Content now sits in a centred column of at most 640 dp.
- **Rest dock**: +30s and Skip were 40 dp; they are now 48 dp, and the dock sits on the navigation surface.
- **Home order**: the next workout and Start now lead the screen, as `DESIGN.md` specifies.
- **Units**: new installs default to pounds, with a kg/lb choice in the first-run setup card.

## Method

- **Compiler**: babel-plugin-react-compiler with babel-preset-expo's production options; the logger records every compiled function and bailout.
- **Renders**: `tests/renders.test.tsx` renders the real `App` with the same compiler transform and counts component invocations per interaction against 10,000 saved sessions. The mock renders every history row; production recycles rows natively, so History counts are an upper bound.
- **CPU**: `check-performance.ts` on Node 24 (darwin/arm64). The formatting comparison was paired in one process (old and new alternating, outputs compared).
- **Device**: `measure-device.mjs` drives release APKs built with `EXPO_PUBLIC_FIVEFOLD_PERF=1 EXPO_PUBLIC_FIVEFOLD_SEED=10000` on an Android 15 arm64 emulator (read-only AVD). Baseline and candidate APKs were installed alternately (ABAB) in a quiet window, so drift affects both. Normal builds exclude the instrumentation: a production export contains neither `FIVEFOLD_PERF` nor the seed code.

## Results

Render invocations per interaction (10,000 sessions):

| Interaction | Before | After |
|---|---:|---:|
| Log a set | 21 | 12 |
| Log another set during rest | 21 | 12 |
| Type one note character | 20 | 2 |
| Rest timer tick | 1 | 1 |
| Open weight sheet | 24 | 8 |
| Close weight sheet | 17 | 1 |
| Switch to Train / Settings / Progress | 18 / 10 / 90 | 25 / 12 / 93 |

Tab switches mount a few more, smaller components (app bar, navigation, and one card component per exercise) so that later updates stay local.

Device, release builds, two alternating rounds, 30 cold starts and 30 set taps per build:

| Metric (median / p95) | Before | After | Change |
|---|---:|---:|---:|
| JS per set tap: save + render + commit | 12.4 / 60.2 ms | 8.5 / 23.0 ms | −31% / −62% |
| React render and reconcile only | 7.0 / 41.1 ms | 3.3 / 10.0 ms | −53% / −76% |
| SQLite current-state save | 5.9 / 11.2 ms | 5.4 / 20.5 ms | unchanged code; noise |
| JS startup to first ready commit | 543 ms | 551 ms | within noise |
| `am start -W` TotalTime | 1,876 ms | 1,818 ms | within noise |
| PSS after startup | ~120 MB | ~120 MB | unchanged |

Paired Node formatting comparison, 1,000 weights plus 1,000 dates, byte-identical output: 14.5 ms → 0.57 ms median.

### Startup regression found and fixed

The first device A/B showed JS startup-to-ready 22% slower in both rounds (511 → 625 ms and 491 → 533 ms). The cause was eight `Intl` formatters constructed eagerly when `format.ts` loaded: in Node, construction costs about 1 ms each, versus 0.4 µs per format call afterwards. The previous code constructed only the few formatters the home screen used. Making each formatter lazy (built on first use, then cached) returned startup to parity (543 → 551 ms).

## Limits

- Emulator frame statistics (`dumpsys gfxinfo`) reported 95–100% janky frames for both builds; they cannot show a difference and are not used as evidence. Frame pacing needs a physical device.
- All device numbers come from one emulator. They support relative comparisons, not absolute claims about phones.
- Cached formatters keep the locale they were created with until the app restarts.

## Reproduce

```sh
pnpm run check                                   # includes the compiler gate and render snapshot
FIVEFOLD_PERF_LABEL=after pnpm run perf          # artifacts/perf/cpu-after.json
FIVEFOLD_PERF_LABEL=after pnpm run perf:renders  # artifacts/perf/renders-after.json
# Release APK with EXPO_PUBLIC_FIVEFOLD_PERF=1 EXPO_PUBLIC_FIVEFOLD_SEED=10000, then:
node measure-device.mjs --serial emulator-5554 --apk <apk> --label <label> --starts 15 --workouts 1
```
