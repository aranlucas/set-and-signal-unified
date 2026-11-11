# Plan 004: Bind the Garmin OAuth callback to the browser that started it

> **Executor instructions**: Follow this plan step by step. On a STOP condition,
> stop and report. When done, update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 89b4879..HEAD -- internal/garmin internal/httpapi/garmin.go`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `89b4879`, 2026-11-11

## Why this matters

`Service.Begin` (`internal/garmin/service.go:152-158`) binds the OAuth `state`
only to the uid that started the connection. `garminCallback`
(`internal/httpapi/garmin.go:45-56`) is unauthenticated, and `Finish`
(`service.go:160-195`) saves the grant under `request.UID` for whichever Garmin
account authorized it. This is the classic OAuth login-CSRF shape. An account
holder starts a connection, then gets someone else to open the authorization URL. If the
Garmin Auth issuer approves without a prompt (for an already-approved public
client), the other person's Garmin account is linked to the first account.
The first account can then read that person's health data through
`/api/garmin/day` and `/api/garmin/activity`.

Confidence is MED: exploitability depends on whether the issuer shows consent
each time. The fix is cheap and standard (RFC 6749 §10.12) either way.

## Scope

**In scope**: `internal/garmin/service.go`, `internal/httpapi/garmin.go`,
`internal/garmin/service_test.go`, and the Garmin tests in `internal/httpapi/router_test.go`.

**Out of scope**: the Garmin Worker in `apps/garmin`; grant encryption and storage.

## Steps

1. In `garminConnect`, set a short-lived (10 min) `HttpOnly; Secure; SameSite=Lax`
   cookie `garmin_oauth=<random nonce>`, and store a hash of the nonce in the
   pending record. In `garminCallback`, require that cookie, compare it in
   constant time with the pending record, and clear it. Android starts via
   bearer auth in a browser. If that browser can't carry the cookie, also accept
   a session or bearer identity whose uid equals the pending uid.
2. In `Finish`, refuse a `GarminID` already linked to a different uid (scan
   or index the grants), with a clear message.
3. Tests: in `service_test.go`, a callback without or with a mismatched nonce
   fails and saves no grant; a matching nonce links the account; a second uid
   linking the same Garmin ID is refused.

## Done criteria

- [ ] New tests pass (`go test ./internal/garmin`; httpapi in CI)
- [ ] The existing connect/disconnect tests are unchanged and green

## STOP conditions

- The Android connect flow can't carry the cookie or an identity to the
  callback. Report it with the flow you observed; don't drop the check.

## Maintenance notes

Any new OAuth client flow in this repo needs the same browser binding.
