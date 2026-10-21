# Garmin integration research

Checked **2026-10-21**. The newly published Personal API changes the access model substantially; older integrations and articles describing business-only access are now incomplete.

## The new program

[Garmin’s program overview](https://developer.garmin.com/gc-developer-program/overview/) now distinguishes personal access from business integrations. Personal access is for your own data, uses pull delivery, and includes activity, health, and women’s health data. Business Starter uses push delivery; Enterprise offers additional delivery and history options. These tiers should not share authentication or delivery assumptions.

[Garmin’s Personal API instructions](https://developer.garmin.com/gc-developer-program/personal/personal-api/) document key creation in [Garmin Connect settings](https://connect.garmin.com/app/settings/personalApiToken). The documented exchange is:

```http
POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token
Authorization: ApiKey <personal-api-key>
```

The [Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/) says keys can expire after 30, 90, or 180 days, or one year. Access tokens last 24 hours or until the key expires. There are no refresh tokens; obtain another access token with the key. Deleting the key invalidates it and its associated tokens. This is intended for personal applications, not commercial services for multiple users.

These personal pages are part of a Gatsby site. The directory `/personal/` initially returns an empty page and redirects in JavaScript to `/personal/personal-api/`. Search indexing was incomplete during this research. The pages and their public JavaScript bundles were fetched directly to verify the current content.

## Existing integrations reviewed

| Integration | Approach and fit |
| --- | --- |
| [Taxuspt/garmin_mcp](https://github.com/Taxuspt/garmin_mcp) | Python MCP using `python-garminconnect`. Broad activity, health, training, and write capabilities. Its documented authentication uses an unofficial Garmin Connect session and locally stored credentials/tokens. Useful when broad website functionality is needed; not an implementation of the newly documented Personal API. |
| [epodivilov/garmin-connect-mcp](https://github.com/epodivilov/garmin-connect-mcp) | TypeScript/Node MCP using the `garmin-connect` package. Documents Garmin username/password configuration, health data, activity queries, and training volume analysis. Its checked package manifest uses MCP SDK v1 and `garmin-connect` 1.6.2. |
| [cyberjunky/python-garminconnect](https://github.com/cyberjunky/python-garminconnect) | An extensive Python wrapper used by other integrations. Documents username/password login with saved sessions and a map of the Connect web application’s endpoints. Broader than the official Personal API, with greater coupling to website authentication and implementation changes. |
| [Pythe1337N/garmin-connect](https://github.com/Pythe1337N/garmin-connect) | Node/TypeScript wrapper for reading and writing Garmin Connect data; the library used by the TypeScript MCP above. Documents account login and saved tokens. Not needed for the new key exchange. |
| [Official business APIs](https://developerportal.garmin.com/developer-programs/connect-developer-api) | Intended for organization integrations, with a separate app registration and end-user authorization model. Includes Training and Courses publishing; availability and delivery depend on the business tier. It adds onboarding and data delivery infrastructure that this personal, pull-based MCP does not need. |

This was a focused review of relevant source repositories, not an exhaustive inventory of every Garmin partner or community MCP. No claim is made that this is the first MCP supporting the new API.

## Endpoint evidence

[Garmin’s public Personal Swagger page](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/) embeds OpenAPI 3.0.1 in its JavaScript bundle. The extracted snapshot is [garmin-personal-openapi.json](garmin-personal-openapi.json), API version `1.0.0`, with server `https://personal.connectapi.garmin.com` and **26 GET paths**.

The server implements those paths, with matching path/query parameter names, and human-readable MCP tool names. They include nutrition, profile settings, fitness age, and HRV alongside activity and daily wellness reads. All published paths are read-only. There is no documented Personal API workout upload or course publishing path in this snapshot. Metric availability or unlimited history should not be inferred from the existence of a path.

The token exchange is documented separately from this schema. Its response body, rate limits, and historical retention were not specified in the public material reviewed. The adapter accepts `access_token` or `accessToken` and rejects other shapes. A real-account verification is still required; mocked tests cannot establish account eligibility, endpoint availability, token response shape, or real returned field completeness.

## Implementation decision

TypeScript fits Workers’ native runtime and the [official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk). npm’s stable tag on this date is **`@modelcontextprotocol/server` 2.3.1**, with client 2.3.1 for tests. The former combined `@modelcontextprotocol/sdk` package is the older v1 release line. Go was not selected because TypeScript can run directly in Workers and the requested latest official SDK is available for this runtime.

The authentication screen belongs to this MCP. It does not impersonate a Garmin-hosted authorization page. [Cloudflare’s OAuth provider](https://github.com/cloudflare/workers-oauth-provider), pinned at 1.2.3, implements client registration, discovery, S256 PKCE, encrypted grant properties, refresh, revocation, and browser-bound consent. Its [consent-page helpers](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/consent-page.md) keep authorization requests server-side and protect the POST with a one-use browser-bound handle.

The assistant receives a token issued for this MCP resource. The Worker retains the key in encrypted grant properties and exchanges it with Garmin as needed. This follows [Cloudflare’s remote MCP authorization guidance](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/). The Worker checks `garmin:read` itself, and two women’s health tools require an explicitly selected additional scope. The key never appears in tool definitions, client configuration, or tool output.

Request-local token acquisition avoids storing another upstream credential or health-data cache. It costs one Garmin token exchange per data-bearing MCP request; if measured usage later needs a shared cache, it must preserve credential encryption, per-user separation, expiry, and revocation semantics.

The default deployment uses one Worker and a dedicated KV namespace. No database, business webhook receiver, scheduled polling, or unofficial Garmin login dependency is necessary. Personal keys must be generated by the user in Garmin Connect; the server cannot automate that consent step.
