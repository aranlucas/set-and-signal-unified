# Installed-app E2E

`tests/e2e/` holds deterministic end-to-end tests that drive the installed
release APK on an emulator or a connected phone. They exist for the part of
the app Vitest cannot reach: the Expo UI Compose controls, their
accessibility labels, the SQLite round trip through a real process restart,
and the sheets and dialogs that only exist on a device.

The runner is [`e2e`](https://e2e.tester.army) with its
[`@e2e-dev/mobile`](https://e2e.tester.army/docs/mobile) engine, which is built
on [agent-device](https://github.com/callstack/agent-device) — the same device
driver `android-smoke.ts` already used. Tests are TypeScript, use
Playwright-style locators and assertions, and the suite as committed needs no
model or API key: every step is a locator or an assertion, with no
`agent.act` / `agent.assert` call.

## Setup

The repository carries the full `e2e init` setup:

```sh
pnpm exec e2e init --engine mobile --gateway openai-compatible \
  --endpoint https://freellmapi-production-1175.up.railway.app/v1 \
  --skills .agents/skills,.claude/skills --mcp .mcp.json --install
```

That installed:

- `@e2e-dev/mobile` and `e2e` as dev dependencies, plus the agent skill in
  `.agents/skills/e2e/` (with `.claude/skills/e2e` linked to it).
- `.mcp.json`, which registers the `e2e` MCP server for agents.
- The `.e2e/` ignore entries for results, traces, replay cache and reports.
- `tests/example.e2e.ts`, adapted here to a mobile smoke test instead of the
  scaffold's web `fetch` example.

`e2e.config.ts` targets the package id `app.fivefold.lifts`, pins
`workers: 1` (the suites share one device) and declares one optional agent
model. It does not start Metro or a web server.

## Run

```sh
pnpm run build:apk                    # or build and install however you prefer
adb install -r artifacts/Fivefold.apk
pnpm run test:e2e                     # E2E_TELEMETRY_DISABLED=1 is set here
```

Run one file while iterating:

```sh
pnpm exec e2e run tests/e2e/settings.e2e.ts
```

`e2e.config.ts` drives whatever build is installed under the package id, so
Metro does not have to be running. With several devices booted it drives one
of them; set `E2E_DEVICE=emulator-5556` to pin the target for this repository. Each pinned device gets its own driver session so separate runs do not compete for the same session. The config also supports a literal device identifier:

```ts
engine: mobile({ platform: "android", device: "emulator-5556" }),
```

Use a QA installation. Each test file starts with `app.clearState()`, which
deletes the app's database, and some files create complete workout logs.

Results, traces, screenshots and the readable accessibility tree of every
failure land in `.e2e/` (git-ignored). A failing step prints a link to
`trace.md`, which is the fastest way to write or repair a selector.

## Agent model (optional)

`e2e.config.ts` declares `agents.default` with
`createOpenAICompatible`, pointed at the FreeLLM endpoint:

```ts
const freellm = createOpenAICompatible({
  name: "freellm",
  baseURL:
    process.env.FREELLM_BASE_URL ??
    "https://freellmapi-production-1175.up.railway.app/v1",
  apiKey: process.env.FREELLM_API_KEY,
});

// `auto` lets the endpoint route to the best model in the active chain.
model: freellm.chatModel("auto");
```

Set the key in the shell that runs e2e when adding a test that uses
`agent.act`:

```sh
export FREELLM_API_KEY=...
```

No model id is pinned: the endpoint's `auto` model selects one. The
deterministic suites never acquire a model, so they pass without the key.

## What it covers

The installed-app scenarios are organized into serial groups, a navigation regression, and a smoke test:

- `tests/e2e/workout.e2e.ts` (8): clean install starts A; logging a set runs
  the rest timer, `+30s` and `Skip`; `Undo` restores a set; a logged set
  survives a restart; correcting reps, recording 0 and clearing a set; writing
  a note, logging all 15 sets and saving; History detail with the note and
  volume; Progress records and the weight chart; the next workout and its
  progressed weights.
- `tests/e2e/workout-b.e2e.ts` (5): a complete A → B cycle split at the saved-A boundary so each workout retains the default 120-second test budget, with the deadlift
  1×5; B history with its volume; saving an unfinished workout as skipped; a
  partly skipped lift keeping its planned weight.
- `tests/e2e/settings.e2e.ts` (8): group values; converting kg ↔ lb; editing a
  planned weight in the numeric field; warm-up and plate guidance; progression
  and deload switches; appearance; rest lengths and workout toggles; the
  backup and export actions.
- `tests/e2e/recovery.e2e.ts` (6): discarding an active workout; resuming one
  after a restart; switching the next workout A ↔ B; saving a partial workout;
  keeping it in history across a restart; deleting it again.
- `tests/e2e/insights.e2e.ts` (6): All/A/B history filtering and empty states; successful and skipped-lift progression explanations; four weekly counts; existing records and weight history; partial B loads; persistence after restart.
- `tests/e2e/navigation.e2e.ts` (1): system Back from History, Progress, and Settings returns to Train instead of the Android launcher. The insights and workout suites also check Back from saved workout details.
- `tests/example.e2e.ts` (1): the installed app launches and exposes Train,
  History, Progress and Settings.

`tests/e2e/support.ts` holds the shared `tap`, `startWorkout`, `logAllSets`,
`finishWorkout` and `discardWorkout` helpers. It is not a `.e2e.ts` file, so
the runner does not collect it.

This now covers every scenario in `android-smoke.ts`. The script
stays as a smaller agent-device snapshot/click example, not as the test gate.

## Compose caveats

Expo UI renders a control's label and its clickable region as two nodes: a
`text` node and a sibling unnamed `button` node. A tap on the label fails with
`has no parent-owned touch point outside its interactive descendants`, because
the touch target belongs to the sibling.

The `tap` helper therefore reads the label's box and taps its centre through
the viewport. It also waits for two matching box reads first: a bottom sheet
that is still sliding up reports a box below its final position, and an early
tap can land on the sheet's backing scrim instead of the control. Assertions
do not need this: labels and text are read straight from the tree.

These device-only details show up in selectors:

- On compact screens, the default viewport swipe can begin inside the fixed rest dock. `scrollWorkoutUntilVisible` derives a bounded swipe path from the toolbar and navigation positions so gestures start inside workout content.
- The workout header (`0 / 15 sets`) is inside the lazy list. Once the list is
  scrolled to the sets, the header is virtualized out of the tree, so
  `logAllSets` checks the counter once at the end, after scrolling back up.
- The note field has no accessible name; target it as `getByRole("textbox")`.
  The weight sheet has two unnamed fields, so take `.first()` for the weight.
- The suggested warm-up is one text node with newline-separated entries, so
  match it with one regex spanning the entries rather than one assertion per
  line.

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

## Release regression gates

The release checks run on QA data and deliberately clear it. Pin the device:

```sh
E2E_DEVICE=emulator-5556 pnpm run test:e2e
E2E_DEVICE=emulator-5556 pnpm exec e2e run tests/e2e/upgrade.e2e.ts
E2E_DEVICE=emulator-5556 FIVEFOLD_PREVIOUS_APK=artifacts/Fivefold-1.2.1.apk pnpm exec e2e run tests/e2e/upgrade.e2e.ts
E2E_DEVICE=emulator-5556 pnpm exec e2e run tests/e2e/backup.e2e.ts
E2E_DEVICE=emulator-5556 pnpm exec e2e run tests/e2e/large-text.e2e.ts
E2E_DEVICE=emulator-5556 pnpm exec e2e run tests/e2e/accessibility.e2e.ts
```

- `upgrade.e2e.ts` verifies the matching SHA-256 sidecar of the previous
  signed APK, installs it with fresh data, saves one set/workout through UI
  shared by both versions, explicitly selects kg when offered, then installs
  the current APK **without** reinstalling. It checks History, next B, kg,
  and Standard gym plates. Its `finally` reinstalls the current APK cleanly.
  Missing APKs/checksums fail with their required paths; they never skip.
- `backup.e2e.ts` pushes the byte-exact real 1.2.1 backup fixture to Documents
  and restores through Android DocumentsUI. It checks kg, History and the
  missing-plates migration, then exports a custom inventory, clears state,
  restores, exports again and compares both the full JSON documents and
  bytes. Case-insensitive folder/permission controls support Android 15/17.
  Cleanup removes only files created by this run, including exported backups.
- `large-text.e2e.ts` sets system text to 200%, checks single-line tabs and
  non-overlap, plate button columns and the 20-pair cap, equal non-overlapping
  set widths, and the unachievable-load warning and tools copy within screen
  bounds. An `afterAll` restores font scale to 1.0 even on failure.
- `accessibility.e2e.ts` checks names and enabled 48×48 dp interactive targets
  across first-run home, Settings and all its sheets, weight editing, active
  workout, rest dock, rep editing, tools, finish, History list/detail and
  Progress. It collects all violations rather than stopping at the first
  target. It enumerates engine roles first; the Android adapter maps clickable
  Compose View rows to generic groups and does not expose their clickable flag
  or name through locator attributes, so UIAutomator supplements those nodes
  and merged descendant names. Android allows only one automation connection:
  the test retires the snapshot helper before dumping, then a subsequent engine
  query verifies that the same session reconnects without restarting the app.
  Sizes use `wm density`; targets touching scroll/app
  bar/rest dock clipping edges are excluded until fully exposed. Failure
  messages list screen, label, class, bounds and dp size. This deterministic
  audit complements a human TalkBack pass.
- `plates.e2e.ts` covers the bounded solver's UI, the zero-pair boundary,
  standard/custom inventory guidance and applying a closest load.

| Environment variable | Meaning |
| --- | --- |
| `E2E_DEVICE` | adb serial for one already-running device. Required when more than one device is online. Each serial has its own engine session. |
| `FIVEFOLD_PREVIOUS_APK` | Previous signed APK for the upgrade suite. Defaults to the highest `artifacts/Fivefold-X.Y.Z.apk` version below `package.json`. The matching `<apk>.sha256` is required. |
| `FIVEFOLD_APK` | Current signed APK for upgrade and matrix runs. Defaults to `artifacts/Fivefold-<package version>.apk`. |
| `FIVEFOLD_E2E_AVDS` | Comma-separated distinct AVD names for the matrix. Defaults to `Pixel_API_35,Agents_Android_17_API_37_2`. |

The `adb()` helper resolves `$ANDROID_HOME/platform-tools/adb`, then
`~/Library/Android/sdk/platform-tools/adb`, then `adb` on PATH. With no
`E2E_DEVICE` it requires exactly one online device. It is used only for
operations missing from the engine: shared files, display metrics and font
scale, and the accessibility fallback described above.

```sh
pnpm run verify:apk
pnpm exec tsx verify-apk.ts artifacts/Fivefold-1.3.0.apk
pnpm run test:e2e:matrix
FIVEFOLD_E2E_AVDS=Pixel_API_35 FIVEFOLD_PREVIOUS_APK=artifacts/Fivefold-1.2.1.apk pnpm run test:e2e:matrix
```

`verify:apk` uses the latest stable SDK build-tools under `$ANDROID_HOME`
(or the standard macOS SDK directory). It fails on a wrong signing
certificate, failed signature/alignment, wrong package/version/code, target
SDK below 36, a debuggable APK, missing ABIs, non-portrait launcher, measurement
instrumentation in the Hermes bundle or a mismatched checksum when a sidecar
exists. An explicit historical `Fivefold-X.Y.Z.apk` path checks the filename
version; versionCode is checked against `app.json` when that version matches
`package.json`. Default invocations require the current package version/code.
The pure gates and matrix parsing have SDK-free Vitest coverage in
`tests/verify-apk.test.ts`.

The matrix boots each AVD read-only on an unused even port starting at 5560,
waits for boot, installs the APK and runs the full suite with a pinned serial.
It preserves all environment variables, including both upgrade APK overrides,
and tees output to `artifacts/release-<version>/e2e-android<API>.log`.
Each device prints API level, passed/failed/skipped counts and duration. It
kills only the emulator it started, and fails clearly if an AVD is already
running rather than reusing or killing it. Shut down those QA AVDs yourself
before running the matrix; their persistent installs survive read-only boots.
