# Fivefold

<!-- impeccable:product-schema 1 -->

## Platform

android

## Product Purpose

The user wants a simple 5×5 app that tracks set and rep counters, with a native Android experience and an installable, tested APK.

## Capabilities and Constraints

- Use current stable React Native through the compatible Expo SDK. Research current official documentation before changing the stack.
- Use Expo UI for application controls and layouts. The current implementation uses Jetpack Compose and Material 3.
- Preserve the A/B workout loop, deadlift 1×5, explicit zero versus skipped results, progression, offline autosave/resume, rest timers, history and backup.
- The implemented app is Fivefold; current release evidence is in `docs/verification.md`.

## Confirmed Design Direction

The user chose **StrongLifts-style focus**. Keep fast, focused 5×5 logging central. Use Strong and Hevy as secondary references for tighter layouts and useful previous-performance context. Current source references are documented in `docs/design/competitor-ui.md`.

## Product Principles

- Prioritize the next workout, current load and set counters.
- Make corrections explicit and recoverable.
- Preserve workout data across interruption and app updates.
- Verify rendered behavior in the installed native app.

