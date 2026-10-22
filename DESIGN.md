# Fivefold design direction

## Confirmed Direction

StrongLifts-style focus leads the design. Strong and Hevy inform compact layout and previous-performance context. Keep the fixed 5×5 lifting loop central.

## Native System

Use Expo UI's Jetpack Compose controls and Material type/color roles. The current release uses a green seeded Material palette, neutral tonal surfaces, light/dark/system appearance, and official Material Symbols (Outlined style) from `@expo/material-symbols`, imported per icon from the package instead of copied into `assets/`. The palette is an implementation choice; the user's confirmed preference is the workout-app direction.

Use 16dp screen gutters and an 8dp spacing rhythm. Set targets are numbered, at least 48dp, and separated by 8dp. Respect native font scaling and allow content to wrap and scroll.

## Workout Hierarchy

Show workout identity and reachable Finish/Undo actions in the app bar. Lead each exercise with its name, editable load, numbered counters and previous result. Unlogged counters show +; partial results include the target, such as 0/5. Put secondary warm-up and plate tools in a native sheet.

Keep a compact rest dock with the upcoming exercise/set, deadline-based countdown, adjustment and Skip. Use aligned results in history, all five lift records before detailed trends, and grouped settings with native editors. Avoid motivational hero copy above workout data.

## Evidence

Research, independent reviews and responses: `docs/design/`. Native screenshots: `artifacts/design/`. Release verification: `docs/verification.md`. Competitor promotional assets are references, not app assets or proof of exact installed-version parity.
