# Business Training API (experimental)

The Training API publishes structured workouts and workout schedules to Garmin Connect. Garmin Connect then syncs them to compatible watches and cycling computers. The Activity API linked in the original brief reads recorded activities; it does not publish training workouts. Garmin's current program overview includes Training API access under Business Starter and Enterprise.

This implementation is default-off and isolated in `src/training/`. It is intended for an approved Garmin business application. It does not simulate approval, bypass Garmin permissions, or use undocumented Connect website endpoints.

## Enable for an approved application

1. Confirm the workout and schedule contracts below against the application's current Training API reference in the Garmin developer portal. The detailed reference requires portal access; no approved-app credentials or live write were available for this implementation.
2. Register `${PUBLIC_URL}/training/callback` as the Garmin redirect URI. Use the canonical HTTPS origin of this deployment. Local development uses the repo's `http://localhost:5173`; Garmin must accept that redirect or you need a registered HTTPS development origin.
3. Set the build environment `GARMIN_TRAINING_ENABLED=true` and `GARMIN_TRAINING_CLIENT_ID` to the approved application's client ID. `cloudflare.config.ts` emits these as Worker text bindings, defaulting to `false` and an empty ID. These settings must also be present in CI when redeploying. Only the literal string `true` enables the feature. For local development, the same bindings can be supplied in an ignored `.dev.vars` file.
4. Install `GARMIN_TRAINING_CLIENT_SECRET` as a Worker secret in the Cloudflare dashboard under the Worker's Variables and Secrets settings. For local use, put it in the ignored `.dev.vars` file. Never put it in tracked config, MCP configuration, or chat. This optional secret is validated at runtime rather than declared globally required, so disabled Personal deployments do not require it.
5. Build and deploy through the existing workflow. Add `${PUBLIC_URL}/training/mcp` to an MCP client with OAuth and approve the workout-write consent, then sign in at Garmin and permit **Workout Import**. This is a separate connector from the Personal endpoint. `/training` provides setup and storage details.

If disabled, all training routes and their discovery documents return 404. If enabled without the app credentials, they return a redacted 503. Turning the flag off blocks existing training sessions too; the Personal endpoint stays available. This switch does not revoke upstream Garmin consent or erase encrypted grants.

## Endpoint and credential boundaries

- Personal resource and issuer: `/mcp` and the deployment origin; key-based Garmin access remains read only.
- Training resource and issuer: `/training/mcp` and `${PUBLIC_URL}/training`.
- Training authorization: `/training/authorize`; token and revocation: `/training/oauth/token`; client registration: `/training/oauth/register`.
- Training discovery: `/.well-known/oauth-authorization-server/training` and `/.well-known/oauth-protected-resource/training/mcp`.
- MCP write permission: `garmin:workouts:write`. Garmin's `WORKOUT_IMPORT` is checked independently at sign-in and before each tool call. It is a Garmin permission, not an OAuth scope to request from Garmin.

The existing `@cloudflare/workers-oauth-provider` library owns MCP authorization, client registration, consent, browser-bound upstream state, PKCE transaction storage, token encryption, refresh and revocation. Training grants have a distinct tag and resource audience, and the cookie prefix differs from Personal consent. Tokens issued for `/mcp` cannot authorize `/training/mcp`.

Garmin access and refresh tokens are encrypted in the library's OAuth grants in the existing `OAUTH_KV` namespace; their values never appear in MCP results. Response data is request-local. Refresh exchanges persist Garmin's replacement token pair in the encrypted grant. MCP access-token lifetime is bounded by the upstream access-token lifetime with a 600-second safety margin. The client does not retry writes, refresh on an ambiguous write response, or follow credential-bearing redirects.

Revoke Garmin consent in **Garmin Connect → Connected Apps**, and revoke the MCP grant using the training issuer's advertised revocation endpoint. MCP revocation removes local access; it does not call Garmin's registration-deletion API. No partner-side upstream disconnect control or Garmin permission webhook is implemented. Permissions are fetched before tools execute so removed workout permission stops further operations. Already published workouts and calendar entries remain in Garmin Connect.

## Tools and examples

`create_workout` publishes a workout without scheduling it. Keep its returned `workoutId`, then pass that ID and an approved calendar date to `schedule_workout`. They are separate calls so that a schedule failure does not hide a successfully created workout or cause automatic duplicate creation. Inspect the account before retrying any failed write; timeouts and invalid success responses can leave an unknown outcome.

For example, create a 30-minute easy run:

```json
{
  "workout": {
    "workoutName": "Easy run — 30 minutes",
    "sport": "RUNNING",
    "steps": [
      {
        "type": "WorkoutStep",
        "stepOrder": 1,
        "intensity": "ACTIVE",
        "durationType": "TIME",
        "durationValue": 1800,
        "targetType": "OPEN"
      }
    ]
  }
}
```

Then schedule the returned ID, for example `{"workoutId":123,"date":"2026-10-26"}`. Finally sync Garmin Connect with the compatible device. The result only confirms the Garmin Connect operation.

The provisional input model supports running, cycling, pool swimming, strength, cardio, generic, yoga, and Pilates. Device support for a sport, target, or exercise varies. Simple steps support `TIME`, `DISTANCE`, `REPS`, and `OPEN`; one repeat-block level supports a fixed repetition count. Step order is globally increasing, including nested steps. Nested repeat blocks are deliberately excluded. Pool swimming requires pool length and its display unit. Exercise names/categories use Garmin identifiers and still require verification against the approved reference.

Time values are seconds, distance is meters, and weight is kilograms regardless of display unit. `PACE` and `SPEED` targets use meters per second, so a pace of 5:00/km is approximately 3.333 m/s. Heart rate and power accept a configured Garmin zone or a low/high range. `targetValueType: "PERCENT"` denotes percentage units for heart rate/power. These are adapter assumptions pending the portal review below, not an exhaustive Training API specification.

`get_workout` reads by workout ID; `get_workout_schedule` reads by schedule ID. `list_workout_schedules` accepts an ordered, inclusive range of at most 31 calendar dates. Body-size, step-count, range, and string-length limits are local implementation bounds. Inputs reject unknown fields, server-assigned IDs in create payloads, invalid dates, unordered target ranges, duplicate step orders, and unsupported nesting.

## Contract status and verification

The verified public sources establish Garmin sign-in, permission checking, and Garmin Connect's role in device sync. **Workout routes, payloads, response envelopes, enum values, and units below remain provisional until checked against the approved portal reference.** Tests use mocked contract fixtures; passing tests do not establish live Garmin compatibility.

The adapter currently pins `https://apis.garmin.com` with these paths:

| Tool                     | Method and path                                    | Expected JSON response                               |
| ------------------------ | -------------------------------------------------- | ---------------------------------------------------- |
| `create_workout`         | `POST /training-api/workout`                       | Workout with numeric `workoutId`, name, sport, steps |
| `get_workout`            | `GET /training-api/workout/{workoutId}`            | Workout                                              |
| `schedule_workout`       | `POST /training-api/schedule`                      | Numeric `scheduleId`, `workoutId`, `date`            |
| `get_workout_schedule`   | `GET /training-api/schedule/{scheduleId}`          | Schedule                                             |
| `list_workout_schedules` | `GET /training-api/schedule?startDate=…&endDate=…` | Array of schedules                                   |

Confirm whether provider/source identifiers are required, whether responses return full objects or IDs, and whether step-order and target-unit rules match this subset. Pin a supplied authoritative schema before removing the experimental label. No arbitrary base URL or generic HTTP tool is exposed.

OAuth authorization is pinned to `https://connect.garmin.com/oauth2Confirm`. The token endpoint uses `https://diauth.garmin.com/di-oauth2-service/oauth/token` from the later `OAuth2PKCE_1.pdf`. The earlier PDF uses `connectapi.garmin.com`; verify the approved app's current reference before use. The adapter does not try both hosts with a client secret. Both documents contain inconsistent expiry prose, so actual token-response lifetimes are used. The permission response is expected to be a JSON array of strings; Garmin's public example has a malformed envelope, which also needs live confirmation.

Use `pnpm run check` and `pnpm run build` for local verification. The tests exercise mocked sign-in, scopes and resource isolation, encrypted token handling, refresh rotation, permission checks, tool calls, input validation, cancellation, bounded responses and redacted failures. Live validation still requires signing in with approved credentials, publishing and scheduling a small workout, and confirming it appears after device sync. Check revoked consent and an upstream refresh as part of that validation. The existing `smoke` project continues to test the Personal deployment only.

Sources checked on 2026-10-23:

- [Garmin business program overview](https://developer.garmin.com/gc-developer-program/overview/).
- [Training API: workouts, calendar and device synchronization](https://developer.garmin.com/gc-developer-program/enterprise/training-api/).
- [Activity API: recorded activity data](https://developer.garmin.com/gc-developer-program/enterprise/activity-api/).
- [Later OAuth2 PKCE specification](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf).
- [Original OAuth2 PKCE specification](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf).
- [Portal documentation, authentication required](https://developerportal.garmin.com/developer-programs/programs-docs).
