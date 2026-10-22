# Installed-app E2E

`tests/e2e/` holds deterministic end-to-end tests that drive the installed
release APK on an emulator or a connected phone. They exist for the part of
the app Vitest cannot reach: the Expo UI Compose controls, their
accessibility labels, the SQLite round trip through a real process restart,
and the sheets and dialogs that only exist on a device.

The runner is [`e2e`](https://e2e.tester.army) with its
[`@e2e-dev/mobile`](https://e2e.tester.army/docs/mobile) engine, which is built
on [agent-device](https://github.com/callstack/agent-device) — the same device
driver `scripts/android-smoke.mjs` already used. Tests are TypeScript, use
Playwright-style locators and assertions, and need no model or API key as long
as they contain no `agent.act` / `agent.assert` step.

## Run

```sh
npm run build:apk                    # or build and install however you prefer
adb install -r artifacts/Fivefold-<version>.apk
npm run test:e2e                     # E2E_TELEMETRY_DISABLED=1 is set here
```

`e2e.config.ts` targets the package id `app.fivefold.lifts` and whatever build
is installed under it, so Metro does not have to be running. With several
devices booted it drives one of them; pin the device in the config when the
choice matters:

```ts
engine: mobile({ platform: "android", device: "emulator-5556" }),
```

Use a QA installation. The suite starts with `app.clearState()`, which deletes
the app's database, and it logs a full workout A.

Results, traces, screenshots and the readable accessibility tree of every
failure land in `.e2e/` (git-ignored). A failing step prints a link to
`trace.md`, which is the fastest way to write or repair a selector.

## What it covers

`tests/e2e/workout.e2e.ts` is one serial group:

1. Clean install opens on Workout A and starts it.
2. Logging a set updates the counter, and the set survives an app restart.
3. A logged set can be corrected to 3 reps, recorded as 0, then cleared.
4. All 15 sets are logged, the workout is saved, and the next workout is B.
5. History lists the finished workout and opens its detail.

This is a subset of `scripts/android-smoke.mjs` (which also covers workout B,
the deadlift 1×5, progression, Progress charts and a second restart). The
intent is to move those scenarios here one at a time; the smoke script stays
until it has nothing left that e2e does not.

## Compose caveat

Expo UI renders a control's label and its clickable region as two nodes: a
`text` node and a sibling unnamed `button` node. A tap on the label fails with
`has no parent-owned touch point outside its interactive descendants`, because
the touch target belongs to the sibling.

The suite therefore taps the centre of the label's box through the viewport
(see the `tap` helper). Assertions do not need this: labels and text are read
straight from the tree.

If the app should be testable by id as well, add Expo UI's `testID` modifier to
`Action`, `TextButton`, the set counters and the tab bar, and set
`testTagsAsResourceId` on a root composable. That would also let Maestro target
those controls by `id`. It is a source change plus a rebuild, so it is not part
of this suite.

## Maestro

There are no Maestro flows in this repository. Maestro is the flow runner Expo
documents for E2E, and it would work here, but its YAML has no loops or
assertions computed in code, which is why the 15-set loop and the counter
assertions live in TypeScript instead. `e2e` also records nothing in the app
and needs no separate binary install beyond the npm package.
