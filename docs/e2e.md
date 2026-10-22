# Installed-app E2E

`tests/e2e/` holds deterministic end-to-end tests that drive the installed
release APK on an emulator or a connected phone. They exist for the part of
the app Vitest cannot reach: the Expo UI Compose controls, their
accessibility labels, the SQLite round trip through a real process restart,
and the sheets and dialogs that only exist on a device.

The runner is [`e2e`](https://e2e.tester.army) with its
[`@e2e-dev/mobile`](https://e2e.tester.army/docs/mobile) engine, which is built
on [agent-device](https://github.com/callstack/agent-device) — the same device
driver `android-smoke.mjs` already used. Tests are TypeScript, use
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
of them; pin the device in the config when the choice matters:

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
  baseURL: process.env.FREELLM_BASE_URL ??
    "https://freellmapi-production-1175.up.railway.app/v1",
  apiKey: process.env.FREELLM_API_KEY,
});

// `auto` lets the endpoint route to the best model in the active chain.
model: freellm.chatModel("auto")
```

Set the key in the shell that runs e2e when adding a test that uses
`agent.act`:

```sh
export FREELLM_API_KEY=...
```

No model id is pinned: the endpoint's `auto` model selects one. The
deterministic suites never acquire a model, so they pass without the key.

## What it covers

Four serial groups and a smoke test, 27 tests total:

- `tests/e2e/workout.e2e.ts` (8): clean install starts A; logging a set runs
  the rest timer, `+30s` and `Skip`; `Undo` restores a set; a logged set
  survives a restart; correcting reps, recording 0 and clearing a set; writing
  a note, logging all 15 sets and saving; History detail with the note and
  volume; Progress records and the weight chart; the next workout and its
  progressed weights.
- `tests/e2e/workout-b.e2e.ts` (4): a complete A → B cycle with the deadlift
  1×5; B history with its volume; saving an unfinished workout as skipped; a
  partly skipped lift keeping its planned weight.
- `tests/e2e/settings.e2e.ts` (8): group values; converting kg ↔ lb; editing a
  planned weight in the numeric field; warm-up and plate guidance; progression
  and deload switches; appearance; rest lengths and workout toggles; the
  backup and export actions.
- `tests/e2e/recovery.e2e.ts` (6): discarding an active workout; resuming one
  after a restart; switching the next workout A ↔ B; saving a partial workout;
  keeping it in history across a restart; deleting it again.
- `tests/example.e2e.ts` (1): the installed app launches and exposes Train,
  History, Progress and Settings.

`tests/e2e/support.ts` holds the shared `tap`, `startWorkout`, `logAllSets`,
`finishWorkout` and `discardWorkout` helpers. It is not a `.e2e.ts` file, so
the runner does not collect it.

This now covers every scenario in `android-smoke.mjs`. The script
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

Three more device-only details show up in selectors:

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
