# Plan 001: Ask the signed-in user before the OAuth server issues a code

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 89b4879..HEAD -- internal/oauth docs/consolidation/implementation.md`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `89b4879`, 2026-11-11
- **Shipped**: implemented on branch `improve/oauth-consent` (this plan was selected for implementation)

## Why this matters

`POST /oauth/register` is open RFC 7591 registration: anyone can register a
client with any redirect URI. `GET /oauth/authorize` then checks only that
the redirect URI matches that registration. If the browser already holds a
`gymsid` session cookie, it immediately redirects to that URI with an
authorization code for `ScopeAll`. `gymsid` is `SameSite=Lax`, so a
cross-site top-level link carries it.

The result: a signed-in user who opens one crafted link hands a third party a
code. With its own PKCE verifier, that party exchanges the code for a
30-day refresh token. It can then read and write all training data through
MCP and `/api/convex/token`, read the user's Garmin health data
(`/api/garmin/day`, `/api/garmin/activity`), and publish Garmin workouts.
The login path (`/oauth/login` → OIDC or passkey → `/oauth/resume`) has the
same gap: the page never says which client is asking.

## Current state

- `internal/oauth/register.go:16-44`: unauthenticated registration; redirect
  URIs need only be non-empty and contain no spaces.
- `internal/oauth/authorize.go:57-64`:
  ```go
  if scope == "" {
      scope = ScopeAll
  }

  if u := s.sessionUser(r); u != nil {
      s.issueCodeRedirect(w, r, u, clientID, redirectURI, state, challenge, method, scope, resource)
      return
  }
  ```
- `internal/oauth/authorize.go` `oidcCallback` (end) and `resumeSession` (end)
  also call `issueCodeRedirect` directly after sign-in.
- `internal/httpapi/router.go:251`: `gymsid=...; HttpOnly; SameSite=Lax`.
- `internal/httpapi/router.go:210-217` `requireAnyAuth` accepts any bearer
  token for first-party routes. Scopes are not enforced (see "Maintenance notes").
- Clients: Android (`apps/android/src/data/cloud.ts:279-312`, expo-auth-session
  with DCR) and MCP assistants. Both use the browser authorize flow.
- Conventions: server-rendered HTML pages in this package are hand-built
  strings with `html.EscapeString` (see `loginPage` in `authorize.go`). Tests
  are package-internal, using `store.Open(t.TempDir())` and `httptest`
  (see `internal/oauth/resume_test.go`).

## Commands you will need

| Purpose           | Command                                              | Expected on success                                  |
| ----------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| Format            | `gofmt -l internal/oauth`                            | no output                                            |
| Tests             | `GOMAXPROCS=1 GOGC=50 go test -p 1 ./internal/oauth` | `ok`                                                 |
| Vet               | `go vet ./internal/oauth`                            | exit 0                                               |
| Modernize         | `go fix -diff ./internal/oauth`                      | no diff                                              |
| Race + whole repo | CI `go test -race ./...`                             | passes (modernc sqlite is CI-only on small machines) |

## Scope

**In scope**: `internal/oauth/authorize.go`, `internal/oauth/server.go`,
`internal/oauth/consent.go` (create), `internal/oauth/consent_test.go`
(create), `internal/oauth/resume_test.go`, `docs/consolidation/implementation.md`.

**Out of scope**: scope enforcement on first-party routes; redirect-URI
scheme rules at registration; persisted per-client approvals (each needs a
migration or a client contract change). Don't touch the web SPA or Android:
both already handle an extra browser page and an `access_denied` redirect.

## Steps

### Step 1: Hold every signed-in request for approval

Add `consents map[string]consentPending` to `Server`. Each `consentPending`
embeds `loginPending` and adds `UserID` and a random form `Token`.
`beginConsent(w, r, user, pending)` stores the entry under a new random key
(a fresh TTL; prune expired entries) and redirects to
`/oauth/consent?state=<key>`. Call it in place of `issueCodeRedirect` in
`authorize` (session present), `oidcCallback` (non-web) and `resumeSession`.

**Verify**: `grep -n issueCodeRedirect internal/oauth/*.go | grep -v _test`
lists only its definition and one call in `consent.go`.

### Step 2: Consent page and decision

- `GET /oauth/consent`: require that the session user equals `UserID`. Render
  the escaped client name (self-asserted, so labeled as such), the redirect
  destination (`scheme://host`), the signed-in account, one line per scope, and a
  POST form with the hidden `state` and `token` fields.
- Headers: `Cache-Control: no-store`, `X-Frame-Options: DENY`,
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline';
  frame-ancestors 'none'; base-uri 'none'`, `Referrer-Policy: same-origin`.
  Do **not** add `form-action`: browsers apply it to the redirect to the client.
  Do **not** use `no-referrer` either: it makes the form send `Origin: null`.
- `POST /oauth/consent`, wrapped in `http.NewCrossOriginProtection()`: check the
  user and compare the token in constant time. Then delete the entry atomically
  (only the request that removed it may answer). `allow` → `issueCodeRedirect`;
  anything else → redirect with `error=access_denied`, `state` and `iss`.

**Verify**: `go build ./internal/oauth` → exit 0.

### Step 3: Tests

Follow the pattern in `resume_test.go`. Cover:

- authorize with a cookie redirects to consent without a code;
- the page escapes the client name, shows the destination, and can't be framed;
- an anonymous user or another account gets 400;
- a missing or wrong token or the wrong account gets 400;
- allow issues exactly one code bound to the user and client, and a replay gets 400;
- deny returns `access_denied`;
- a `Sec-Fetch-Site: cross-site` POST gets 403 and doesn't consume the request.
  Update the passkey resume test to go through consent.

**Verify**: `go test ./internal/oauth` → `ok`. Temporarily restore the old
session branch in `authorize`; `TestSignedInAuthorizeAsksBeforeIssuingACode`
must then fail, showing a `code=` redirect.

## Done criteria

- [ ] `gofmt -l internal/oauth` empty; `go vet` and `go fix -diff` clean
- [ ] `go test ./internal/oauth` passes, including the new consent tests
- [ ] No code is issued except from `consentDecision`
- [ ] CI green

## STOP conditions

- An e2e or Android test drives `/oauth/authorize` and expects an immediate
  code redirect. Report it; don't add a bypass.
- Someone proposes trusting a client by `client_name`. Names are self-asserted.

## Maintenance notes

- Follow-ups: (a) remember approvals per (user, client, scope), which needs a
  migration, so the prompt appears once per client; (b) enforce scopes, with a
  first-party scope for `/api/convex/token`, `/api/garmin/*` and `/api/workout/*`;
  (c) restrict redirect URI schemes and hosts at registration.
- Reviewers: check that every path to `issueCodeRedirect` goes through
  `consentDecision`, and that all attacker-controlled strings on the page are escaped.
