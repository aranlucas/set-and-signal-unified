<img src="assets/icon.svg" width="64" height="64" alt="Fivefold barbell icon">

# Fivefold

A focused, offline 5×5 workout log for Android. Built with **Expo SDK 58**, **React Native 0.88.0**, **React 19.3.0**, and real **Jetpack Compose / Material 3 controls through `@expo/ui`**. No account, ads, subscription, analytics, or backend.

## Install

Build a signed standalone APK with `pnpm run build:apk`; the output is `artifacts/Fivefold.apk`. Transfer it to an Android phone, open it, and allow installation from your chosen file/browser app when Android asks. Android 7.0/API 24 or newer is required. The APK contains ARM32, ARM64, x86, and x86-64 code and does not need Expo Go or Metro.

## Training

- Alternate **A:** squat, bench press, barbell row and **B:** squat, overhead press, deadlift.
- Work sets are 5×5, with **deadlift 1×5**.
- Tap + to record 5 reps. Tap a logged counter to choose 0–5 reps or Clear in the native sheet. Undo in the app bar restores the previous result and timer. A zero is an attempted set; empty means skipped.
- Every change is saved locally before the UI acknowledges it. Reopen the app to resume an active workout.
- Finish a workout to save its history, update planned weights, and alternate A/B. Finish is idempotent. Discarding does not alternate or apply progression.
- All prescribed reps completed: add the lift's configured increment. A fully attempted missed lift repeats; after three consecutive misses the default deload is 10%, rounded down to the increment and bounded by the selected bar weight. A partly skipped lift repeats without adding a miss. Automatic increases and deloads can be disabled independently.
- Editing a weight during a workout changes the exercise's weight for all of its sets. History keeps the weight and unit actually saved. Deleting history does **not** recalculate current plans.

## Features

Native bottom navigation and dialogs, a green seeded Material 3 palette, system/light/dark themes, accessible set descriptions and wrapping 48 dp numbered counters, native lazy/recycled history rows, notes, successful-session personal records, a weekly training strip, dated lift-weight charts including misses, prior results, kg/lb, editable bar/weights/increments with quick load adjustments, suggested warmups, standard-plate calculations with explicit impossible-load messages, haptics, screen-awake mode, persistent rest deadlines across tabs with next-set context and +30 seconds/skip, optional local notifications with a silent ongoing workout notification, a home-screen workout widget, JSON backup/restore through Android's native file pickers, CSV export, and optional backup sharing.

My plates tracks available pairs in kg and lb and shows the closest loadable weights when a target is impossible; Standard gym keeps the unlimited standard-plate calculator. Warmups are suggestions, not logged work sets. Rest notifications are scheduled as Android alarm clocks (`USE_EXACT_ALARM`), so battery optimization does not delay them; Android shows an alarm icon while a rest alert is pending, and the in-app deadline remains authoritative. Unit changes round future plans to standard increments and leave original history units intact. The app is independent of StrongLifts.

## Roadmap and quality gates

[The roadmap](docs/roadmap.md) tracks this release and the next improvements. Version 1.2 adds All/A/B history filters, four-week training consistency, explicit latest-lift results, and reasons for next-load changes in the finish preview. Version 1.2.1 restores system Back navigation on Android 15 and adds installed-release regression coverage. Version 1.3.0 adds My plates (available plate pairs with the closest loadable weights), defaults new installs to pounds with a kg/lb choice in first-run setup, fixes layouts at 200% text and on tablets, and refactors state and rendering for fewer re-renders per set; the measurements are in [the React audit](docs/react-audit.md). Progress uses one cached summary with bounded recent entries. Local storage no longer applies backup-import size limits when reopening a training log, and saving remains readable after the device clock moves backward.

`pnpm run check` includes a React Compiler gate (every component must compile), render-count snapshots for common interactions, structural performance regressions, and `pnpm run perf`: a 10,000-session CPU benchmark with a 16 ms p95 main-thread CPU budget for a fresh summary and an 8 ms CPU budget for 1,000 cached reads. These are development-machine gates; release-device startup and frame profiling are tracked separately. Native controls and persistence continue to use Expo libraries, with no new runtime dependencies.

## Development

Use Node 24+, JDK 17, and an installed Android SDK. The tested local SDK has build-tools 37, compile SDK 37, target SDK 36, and NDK 27.1.12297006.

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm dlx expo-doctor
pnpm android
```

`pnpm run check` runs ESLint 10 with TypeScript and React Hooks rules, strict TypeScript, Vitest, and the performance gate. React Compiler and React Native's New Architecture/Hermes are enabled. All app controls/layouts use Expo UI; React Native is used for app lifecycle and system APIs.

`pnpm android` runs Expo's `run:android` command, which generates the native Android project when needed, compiles it, installs it on your device/emulator, and starts Metro. For later JavaScript/TypeScript changes, use `pnpm start`.

For a standalone signed APK, use [EAS Build locally](https://docs.expo.dev/build-reference/local-builds/). The `preview` profile in `eas.json` requests an APK and uses local signing credentials. EAS handles dependency installation, Expo prebuild, Gradle compilation, signing, and copying the finished APK; there is no custom build program.

The `pnpm eas` shortcut runs the pinned EAS CLI through `pnpm dlx`, with its two dependency build scripts explicitly allowed for pnpm 12. Authenticate once with `pnpm eas login`. The app is linked to its EAS project through `extra.eas.projectId` in `app.json`. On a new checkout, create the git-ignored `credentials.json` at the repository root following [Expo's local credentials format](https://docs.expo.dev/app-signing/local-credentials/). Set `android.keystore.keystorePath` to the absolute path of your release keystore and fill in its alias and passwords.

This app's existing signing identity is `~/.local/share/fivefold/signing/release.jks`, with alias `fivefold` and its password in the adjacent `password` file. Reuse that identity for updates. **Back up that directory securely before moving machines.** Keeping the same key and raising `android.versionCode` allows later APKs to update an installation without removing its data. Never commit `credentials.json`, the keystore, or its password.

```sh
pnpm run check
pnpm run build:apk
```

The build runs on your machine and requires an Expo account, JDK 17, and an Android SDK. Set `ANDROID_HOME` when the SDK is outside `~/Library/Android/sdk`. Checks run separately from the build. If you need an artifact checksum, run `shasum -a 256 artifacts/Fivefold.apk`. The versioned APK paths and metadata in `docs/verification*.md` describe earlier releases.

## Verification and research

See [official-source research](docs/research.md), [architecture and data rules](docs/architecture.md), and [release verification](docs/verification.md). The QA script at `android-smoke.mjs` uses the exact `agent-device` launcher and target flags returned by T3 `device_open`. Run it only on a dedicated QA installation: it discards an existing QA workout if needed, logs two full workouts and starts a third.

```sh
node android-smoke.mjs /absolute/path/to/agent-device \
  --platform android --serial DEVICE_SERIAL \
  --config /path/from/device_open.json --session SESSION_FROM_DEVICE_OPEN
```

`artifacts/qa-redesign/` contains the 1.1.0 smoke run; `artifacts/design/` contains before/after native screenshots and design reviews live in `docs/design/`. `artifacts/qa/` contains the earlier release’s native screenshots and structured acceptance results. Android is the implemented and tested platform; this repository does not claim an iOS or web build.

Installed-app E2E lives in `tests/e2e/` and drives the installed release APK with `pnpm run test:e2e` — no Metro and no model key. See [installed-app E2E](docs/e2e.md).
