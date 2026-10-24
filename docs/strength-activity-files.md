# Complete FIT activity data

## Activity reads

`get_garmin_activity` accepts the Garmin `activityId` returned in stored activity summaries and returns the matching summary, JSON details, and `fit`. Existing `get_garmin_summary` activity reads also include `fit` when their JSON contains an `activityId`. The standalone `decode_strength_activity_file` tool is removed; no manual FIT export or base64 input is needed.

The receiver preserves Garmin-supplied JSON exercise/set fields. FIT decoding supplies recorded details that may be absent from that JSON. Matching uses Garmin's explicit activity ID, not time proximity or summary-ID suffixes. Imported summaries can use a subsequently received file for the same activity ID, but the connector cannot request historical files through Starter.

## Delivery and retrieval

The implementation was checked against the approved [Activity API 2.0 reference](https://developerportal.garmin.com/content/activity-api), section 6.4, and the [OAuth2 specification](https://developerportal.garmin.com/content/garmin-connect-oauth-specification-0), section 4, through the signed-in developer portal on October 24, 2026. Garmin documents file metadata delivery, an explicit activity ID, the HTTPS business activity-file callback, and one-use downloads expiring after 24 hours. Its current Starter tier includes these file notifications.

Configure **Activity Files** delivery to the same private webhook URL used for JSON push delivery. After deployment, make one authenticated MCP request per linked account to bind its existing Auth subject to its immutable Garmin account store. Files arriving before that binding remain pending until the account reconnects to MCP or the callbacks expire.

The webhook validates all input before accepting it durably, then acknowledges without upstream calls. The account's Durable Object alarm automatically downloads pending FIT files. It obtains credentials through the existing Auth broker, verifies account identity and current activity permission, and rechecks access before saving. An activity read can claim a pending file while background work is waiting. Claims are durable and exclusive across both paths; duplicates never renew the callback lifetime or repeat a consumed download.

Only `https://apis.garmin.com/wellness-api/rest/activityFile` with a single `id` and `token` query parameter is accepted. User info, fragments, extra parameters, other origins/paths, and redirects are rejected. This path uses business OAuth credentials, never the Personal API. Downloading is bounded to 20 seconds and 1 MiB. Unclaimed jobs survive transient Auth/permission-lookup outages; background attempts back off for a minute. Once a download is claimed, ambiguous failures are terminal because the URL may already have been consumed. A crash leaves the claim unavailable after its lease expires, rather than consuming the link again.

Callback credentials live only in private account storage until claim or expiry. Tools expose neither callback URLs nor parser errors. Original FIT bytes are not retained. All decoded FIT data persists until deletion, disconnect, or withdrawal of activity permission. Versioned completion prevents in-flight downloads from restoring deleted data. Expiry cleanup shares the existing event alarm without replacing its schedule. File notifications do not create workout-completed events.

## Recorded fields and availability

The pinned official `@garmin/fitsdk` handles binary decoding, CRC validation, units, and profile mappings. Validation enforces a complete single activity file, at most 25,000 messages including definitions, 2,000 sets, and 4,000 exercise entries. Invalid files fail without partial messages. The SDK's unsupported compressed-timestamp records are rejected.

Sets retain recorded order, active/rest type, repetitions, kilograms, duration, available timestamps, exercise category/subtype identifiers, and known FIT exercise names. Null means missing or unknown; zero stays zero. Rest is never inferred from gaps, and Training API targets never replace recorded performance. Original files may omit later Garmin Connect edits. All SDK-decoded message types and fields are retained, including GPS, device identifiers, health samples, sessions, laps, events, swimming data, workout steps, unknown fields, and developer fields. There is no sport-specific field whitelist. Numeric IDs identify unknown messages and fields; developer descriptions and units remain alongside developer values. SDK scale/offset and component/subfield expansion are applied. FIT epoch timestamps, numeric enums, and semicircle coordinates keep their SDK representation. BigInt values become decimal strings without precision loss. Group order matches recorded order within each message type. Decoded JSON is bounded to 8 MiB and stored in 64 KiB binary chunks; the complete payload is reconstructed on read without truncating messages or splitting Unicode characters.

`fit.availability` distinguishes available FIT data, absent delivery, pending downloads already claimed by another reader, expired callbacks, unsupported file formats, and failed downloads. `fit.strengthAvailability` separately distinguishes recorded strength sets from files without set messages. An unavailable file or a file without set messages does not establish that no strength training occurred. Activity summaries remain readable when file retrieval fails.

## Verification

Worker tests use SDK-encoded synthetic FIT files and mocked Garmin responses. They cover authenticated push acceptance; automatic alarm retrieval before any read; both MCP activity read paths; account isolation; current permissions; duplicate/concurrent delivery and reads; complete FIT payloads across eviction (including payloads above SQLite’s per-value size limit); callback restrictions and expiry; failed/oversized downloads; and deletion during retrieval. Non-strength fixtures cover GPS/sensor records, sessions, laps, events, device metadata, unknown fields and messages, developer fields, and lossless 64-bit values. Decoder tests separately cover recorded fields, null/zero values, limits, CRC errors, unsupported records, and planned-workout rejection.

No production credentials or real activity file were used. Real Garmin delivery, deployment, and enabling the Activity Files endpoint remain operational verification steps.
