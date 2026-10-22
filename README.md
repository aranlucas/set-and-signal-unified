<img src="assets/icon.svg" width="64" height="64" alt="Fivefold barbell icon">

# Fivefold

A focused, offline 5×5 workout log for Android. Built with **Expo SDK 58**, **React Native 0.88.0**, **React 19.3.0**, and real **Jetpack Compose / Material 3 controls through `@expo/ui`**. No account, ads, subscription, analytics, or backend.

## Install

The signed standalone APK is generated at `artifacts/Fivefold-1.1.0.apk`. Transfer it to an Android phone, open it, and allow installation from your chosen file/browser app when Android asks. Android 7.0/API 24 or newer is required. The APK contains ARM32, ARM64, x86, and x86-64 code and does not need Expo Go or Metro. A SHA-256 sidecar is provided beside the APK.

## Training

- Alternate **A:** squat, bench press, barbell row and **B:** squat, overhead press, deadlift.
- Work sets are 5×5, with **deadlift 1×5**.
- Tap + to record 5 reps. Tap a logged counter to choose 0–5 reps or Clear in the native sheet. Undo in the app bar restores the previous result and timer. A zero is an attempted set; empty means skipped.
- Every change is saved locally before the UI acknowledges it. Reopen the app to resume an active workout.
- Finish a workout to save its history, update planned weights, and alternate A/B. Finish is idempotent. Discarding does not alternate or apply progression.
- All prescribed reps completed: add the lift's configured increment. A fully attempted missed lift repeats; after three consecutive misses the default deload is 10%, rounded down to the increment and bounded by the selected bar weight. A partly skipped lift repeats without adding a miss. Automatic increases and deloads can be disabled independently.
- Editing a weight during a workout changes the exercise's weight for all of its sets. History keeps the weight and unit actually saved. Deleting history does **not** recalculate current plans.

## Features

Native bottom navigation and dialogs, a green seeded Material 3 palette, system/light/dark themes, accessible set descriptions and wrapping 48 dp numbered counters, native lazy/recycled history rows, notes, successful-session personal records, a weekly training strip, dated lift-weight charts including misses, prior results, kg/lb, editable bar/weights/increments with quick load adjustments, suggested warmups, standard-plate calculations with explicit impossible-load messages, haptics, screen-awake mode, persistent rest deadlines across tabs with next-set context and +30 seconds/skip, optional local notifications, JSON backup/restore through Android's native file pickers, CSV export, and optional backup sharing.

The plate calculator assumes standard denominations and enough plate pairs; it does not track gym inventory. Warmups are suggestions, not logged work sets. Background notifications use best-effort Android scheduling and may be delayed by battery restrictions; the in-app deadline remains authoritative. Unit changes round future plans to standard increments and leave original history units intact. The app is independent of StrongLifts.

## Development

Use Node 24+, JDK 17, and an installed Android SDK. The tested local SDK has build-tools 37, compile SDK 37, target SDK 36, and NDK 27.1.12297006.

```sh
npm ci
npm run check
npx expo-doctor
npm run android
```

`npm run check` runs ESLint 10 with TypeScript and React Hooks rules, strict TypeScript, and Vitest. React Compiler and React Native's New Architecture/Hermes are enabled. All app controls/layouts use Expo UI; React Native is used for app lifecycle and system APIs.

```sh
npm run build:apk
# For JS-only iterations after a successful prebuild:
npm run build:apk -- --skip-prebuild
```

The build script runs checks, performs Expo prebuild, builds a minified/resource-shrunk release, signs the APK, verifies its signature and 16 KB ZIP alignment, and writes its checksum and build metadata. Set `ANDROID_HOME` when the SDK is outside `~/Library/Android/sdk`.

The persistent signing identity lives at `~/.local/share/fivefold/signing/`, outside this repository, with private file permissions. **Back up that directory securely before moving machines.** Keeping the same key and raising `android.versionCode` allows later APKs to update an installation without removing its data. Never commit the keystore/password. `--skip-prebuild` is only for JS-only changes; app config/native dependency changes require the normal build.

## Verification and research

See [official-source research](docs/research.md), [architecture and data rules](docs/architecture.md), and [release verification](docs/verification.md). The QA script at `scripts/android-smoke.mjs` uses the exact `agent-device` launcher and target flags returned by T3 `device_open`. Run it only on a dedicated QA installation: it discards an existing QA workout if needed, logs two full workouts and starts a third.

```sh
node scripts/android-smoke.mjs /absolute/path/to/agent-device \
  --platform android --serial DEVICE_SERIAL \
  --config /path/from/device_open.json --session SESSION_FROM_DEVICE_OPEN
```

`artifacts/qa-redesign/` contains the 1.1.0 smoke run; `artifacts/design/` contains before/after native screenshots and design reviews live in `docs/design/`. `artifacts/qa/` contains the earlier release’s native screenshots and structured acceptance results. Android is the implemented and tested platform; this repository does not claim an iOS or web build.
