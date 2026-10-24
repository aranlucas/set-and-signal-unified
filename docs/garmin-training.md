# Garmin Training in the unified connector

Training is now part of `/mcp`, alongside received Health/Activity data. The separate `/training/mcp` issuer and Personal API key flow have been retired. See [setup, architecture, and tests](../README.md).

Auth owns Garmin OAuth 2.0 + S256 through Better Auth's native generic OAuth plugin. Its callback is `https://auth.aranlucas.workers.dev/api/auth/callback/garmin`. The app's client secret stays in Auth; the connector receives short-lived Garmin access tokens only through a private Worker service binding.

The Training client follows the approved Training API V2 2.0 contract:

- Create with `POST /workoutportal/workout/v2`.
- Read, replace, and delete with `/training-api/workout/v2/{workoutId}`.
- Calendar create/list with `/training-api/schedule/`; read, replace, and delete with `/training-api/schedule/{scheduleId}`.
- Validate `WORKOUT_IMPORT` on each tool call using the partner-gateway permissions endpoint.
- Use segments, globally increasing step order, SI units, bounded repeat nesting, and Garmin calendar dates.
- Preserve numeric schedule-create IDs. An empty successful mutation becomes `accepted:true`, without fabricating an ID.
- Never retry ambiguous writes automatically or claim that a watch received a workout.

Worker tests exercise all nine tools with mocked Garmin responses, plus schema bounds, error redaction, abort handling, response limits, redirect rejection, and numeric/empty write responses. Do not create real-account workouts or calendar entries for testing. Live Training API verification uses the read-only `exchange-live` calendar check. Physical watch synchronization and a real near-expiry Garmin token refresh require separate observation; the rotating-token refresh path is tested with Better Auth and real Durable Object RPC under Miniflare.

Official reference material is available to approved developers in the [Garmin developer portal](https://developerportal.garmin.com/developer-programs/programs-docs). Confidential source PDFs and app credentials are not checked into this repository.
