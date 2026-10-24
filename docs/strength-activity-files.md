# Completed strength activity files

Investigated against upstream `00b0b75a17aa7a2d874f05dd59d14a1210671cd7` on 2026-10-24.

## Findings

The existing push schema uses loose objects, and storage serializes unknown provider fields. Only routing credentials and callback URLs are removed. The connector does not discard exercise/set fields from a delivered JSON activity detail. Its category allowlist deliberately rejects `activityFiles`, and the receiver does not fetch callback URLs.

Garmin's [official tier table](https://developer.garmin.com/gc-developer-program/overview/) lists JSON and FIT Activity API data for Starter. Starter is push-only and excludes historical data. FIT availability does not establish which messages a particular device recorded, nor whether a past activity is recoverable through the existing connection.

The [official FIT profile](https://github.com/garmin/fit-javascript-sdk/blob/main/src/profile.js) defines message 225 (`set`) with duration (seconds), repetitions, weight (kilograms; raw scale 16), active/rest type, timestamps, category/subtype arrays, display-unit preference, message index, and workout-step index. These describe recorded sets, unlike planned Training workout steps. A workout-step index alone does not prove a Garmin Training workout-ID association.

## Implemented boundary

The main MCP server registers `decode_strength_activity_file`, a read-only, closed-world tool for explicitly supplied uncompressed FIT bytes encoded as canonical base64. It uses Garmin's maintained, typed SDK rather than reimplementing the binary format. No new authentication, upstream request, stored-data category, retention policy, webhook behavior, or Garmin mutation is introduced.

Validation checks base64, decoded size, FIT header/CRC, exact single-file length, activity file type, decoder completeness, total record count including unknown messages and definitions, set count, aggregate exercise count, and decoded set field shapes. Fixed MCP errors do not echo file contents or parser details. Output includes only recorded set fields, not GPS samples or arbitrary developer fields. Unknown enum identifiers remain numeric with a null name. Category and subtype arrays are paired by position without discarding unmatched entries. Weights remain kilograms even when the stored display preference is pounds.

No recorded sets means missing set detail, not zero activity. Missing/invalid values stay null; zero repetitions/weight/duration remain zero. Rest is returned as its own recorded set, without guessing which exercise it belongs to or deriving rest from timestamps. Original files may omit later edits made in Garmin Connect.

## Verification

Synthetic activity files are encoded with the official SDK and passed through the real decoder. Tests cover active and rest records, fractional weight/duration, exercise names and arrays, missing/zero/unknown fields, relative timestamps, no-set files, planned-workout rejection, base64/ZIP/CRC/truncation/trailing-data failures, size/message/set limits, MCP discovery/call behavior, redacted errors, and no network or persistence. Push regression coverage confirms supplied JSON set fields are retained.

These are synthetic tests, not evidence that a particular watch or real activity contains set messages. No production credentials or real activity file were used. An authorized original file is required to verify a real activity, and deployment is a separate step.

The pinned official SDK does not support FIT compressed-timestamp records. These otherwise valid files fail safely without returning earlier decoded sets; a CRC-valid regression fixture covers this SDK limitation.

## Remaining automatic delivery work

1. Read the approved current Activity API documentation or inspect an authorized, authentic `activityFiles` sample to establish schema and file-specific retrieval requirements. The public [Activity API overview](https://developer.garmin.com/gc-developer-program/enterprise/activity-api/) and general [OAuth2 specification](https://developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf) are not sufficient to infer the callback endpoint contract.
2. Design durable, bounded asynchronous retrieval after authenticated acceptance. Verify exact allowed destinations, reject redirects and unexpected origins, protect callback credentials, and do not pass user-supplied URLs or Personal API credentials through this tool.
3. Preserve account isolation, permission rechecks, deregistration/deletion, idempotence, expiry/retry rules, and no synthetic workout-completed events for imports.
4. Establish documented summary/activity identity mapping before combining FIT sets with existing summaries. Validate a real strength file and a real delivery in an approved environment before claiming end-to-end support.

The checked-in Personal OpenAPI separately documents original activity downloads, but that API uses a different host and authorization model. Its existence does not authorize reuse of business credentials or activating that path here.
