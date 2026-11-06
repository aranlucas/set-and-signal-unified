# Untangle decision log — 2026-11-06

## Scope and baseline

- Entire repository: Go API/auth/store/training/integrations, web/Convex,
  shared packages, Android, Garmin Worker/codegen, documentation and CI.
- Baseline: `fb4697c`; clean checkout, no previous edits to overwrite.
- Comments and Tests additions selected. Tests, benchmarks, browser tests and
  test builds run **only in CI**. No owned local validation process was running.
- Preserve product contracts, typed DTOs, persistence compatibility, offline
  conflict handling, owner boundaries and provider replay protection.

## Inventory before implementation

1. Export training operations where implemented; have HTTP call that package.
   - `internal/training/facade.go` forwards every operation to a private function.
   - `internal/httpapi/training.go` repeats those forwarding functions and DTO
     aliases. A training change crosses up to three declarations for one action.
   - `historyQuery` is an alias for another alias, in an unrelated date file.
   - No external consumers use the HTTP package's training aliases.
2. Depend directly on the shared persistence codec.
   - `web/src/app/store/training-sync.ts` imports through `web/convex/model.ts`,
     although that module only reexports `@set-and-signal/training/state`.
   - Tests and Convex use the same unnecessary path; the stable codec already
     has a supported workspace export.
3. Keep calendar-only date lookup independent of the machine timezone.
   - `internal/training/digest.go` parses a date locally, retries in UTC, then
     reconstructs UTC noon solely to find a weekday. Calendar dates need one
     standard-library parse, with the existing invalid-date fallback preserved.
4. Derive persistence ownership once from standard-library reflection over
   `TrainingData` JSON tags; extend mutation regressions for cleared optional
   strings and untouched large integers.
   - `trainingDataJSONKeys` duplicates persisted struct field names. Optional
     fields must be removed when cleared while unknown fields survive.
   - Existing tests exercise unknown fields, concurrent writes, replay receipts,
     unit conversion, schedule overrides and explicit zero values. These catch
     real bugs and must remain.

## Retained requirements and special cases

- Go and TypeScript domain implementations serve different runtimes; moving all
  policy across a network would break offline behavior. Keep parity fixtures.
- Cloud snapshot/CAS conflict states, pending outboxes, immutable receipt IDs,
  and Garmin ambiguous-write states prevent data loss and duplicate side effects.
- Live Garmin/Convex tests require credentials and explicit opt-in. Keep those
  gates; ordinary CI runs deterministic suites without external writes.
- Provider permission/status handling and bounded response reads belong at the
  integration boundaries. Do not flatten them into generic errors/retries.
- Default arrays, units and legacy state normalization support existing data.
- Browser/device platform branches, cancellation handling and notification timers
  are runtime requirements. Avoid speculative rewrites of those boundaries.
- Existing UI markup tests check visible layout/classes and forwarded attributes;
  do not remove meaningful coverage just because assertions are small.
- Generated catalog, translations, API schemas, imported app formatting and
  deployment declarations remain owned by their current generators/tools.

## Validation and review

Independent inventory review confirmed decisions 1, 2 and 4. Implemented those
and simplified weekday parsing with calendar/invalid-date regression cases.
Removed wake-lock implementation narration; retained browser restrictions. No
meaningful tests removed. No dependencies or script files added; standard Go
reflection handles type metadata, and existing workspace exports handle reuse.

Pending: independent final review and CI. No local tests/builds have run.

### Final review round 1

- Removed the deleted codec module from the committed generated Convex API
  declaration. This is the exact module-list deletion; running Convex dev would
  contact a deployment, so the generated inventory is updated directly.
- Removed remaining HTTP clone forwarders, using slices.Clone and the domain
  clone directly. Updated the persistence-boundary documentation.
- No behavior tests were removed; final review found no meaningless tests.
