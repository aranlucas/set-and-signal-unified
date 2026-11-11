# Plan 005: Stop Android from silently converting weights with a default `lb` profile

> **Executor instructions**: Follow this plan step by step. On a STOP condition,
> stop and report. When done, update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 89b4879..HEAD -- apps/android/src/screens/connected-training-screen.tsx apps/android/src/domain/hosted.ts apps/android/src/data/cloud.ts`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `89b4879`, 2026-11-11

## Why this matters

`ConnectedTrainingScreen` (`apps/android/src/screens/connected-training-screen.tsx:50-51`)
parses the hosted profile with `hostedProfileSchema.safeParse`. On failure it
silently uses `hostedProfileSchema.parse({})`, whose unit defaults to `"lb"`
(`apps/android/src/domain/hosted.ts:32`). That `data.unit` then drives set
conversion, `source.recordedUnit`, and the Garmin FIT kilogram conversion
(same file, around lines 152, 211 and 425).

One routine the schema rejects is enough to trigger this. `hosted.ts:6` requires
integer `sets`, but Go accepts fractional sets (`validate:"gte=1,lte=12"`, then
`roundHundredths` in `internal/httpapi/program_preview.go`). A kg account then
records phone and watch workouts about 2.2× off, with no error, and its routine
list goes empty. `applyHostedFivefold` (`apps/android/src/data/cloud.ts:621-625`)
also returns silently on a parse failure.

## Scope

**In scope**: `apps/android/src/screens/connected-training-screen.tsx`,
`apps/android/src/domain/hosted.ts`, and their tests under `apps/android`.
The Go side applies the integer rule in `internal/training/types.go` (`MCPExConfigInput.Sets`).

**Out of scope**: Android conflict resolution (a separate finding), Gradle builds.

## Steps

1. When the parse fails, render an error state ("Your account data couldn't be
   read; recording is paused") and disable recording and import. Never fall back
   to defaults for `unit`.
2. Prefer the unit stored in `cloud_identity` (`apps/android/src/data/cloud-storage.ts:64-83`)
   for conversion. If it disagrees with the parsed profile unit, surface a conflict.
3. Make Go and Android agree on `sets`: either add `,numeric` integer checking
   in Go (reject fractional sets at the API), or relax Android to `z.number().positive()`.
   Prefer the Go rule, because the web UI only produces integers.
4. Tests: a profile with a fractional `sets` shows the error state and doesn't
   record a workout; the Go input validation rejects `sets: 2.5`.

## Done criteria

- [ ] `pnpm check:android` passes (typecheck, lint, Jest with `--maxWorkers=1`)
- [ ] The Go validation test passes in CI

## STOP conditions

- `pnpm check:android` needs a Gradle or emulator build. Stop; run only the JS checks.

## Maintenance notes

Every hosted schema in `apps/android/src/domain/hosted.ts` must be at least as
permissive as what Go and the web can store, or the screen must fail loudly.
