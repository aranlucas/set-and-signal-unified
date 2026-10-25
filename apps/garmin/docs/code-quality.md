# Code quality audit

Reviewed on **2026-10-23**, starting from `24fa7e2`. The review covered every application module, test, build configuration, and the published Garmin API snapshot. The starting branch was pushed before editing; the baseline passed 15 tests, type checking, linting, and formatting.

## Findings and changes

The original endpoint catalog duplicated a subset of OpenAPI and relied on `parameterSchema()` to interpret it. That interpreter inferred rules from parameter names, including which numbers must be positive and which date ranges are bounded. Direct Zod input schemas now put defaults, limits, allowed values, descriptions, and date refinements beside each tool. The SDK validates those schemas before executing a Garmin request. The catalog helper only supplies shared defaults and checks that path parameter names belong to the declared input.

Activity searches now validate the published favorite values and geographic coordinate bounds, accept case-insensitive sort directions as documented, and reject reversed dates. Daily range tools retain their inclusive 31-day bound; paged searches retain unrestricted history windows. Contract tests compare every published path’s parameter names, locations, types, date formats, defaults, and required fields with the snapshot.

The original Garmin adapter validated response bodies only as JSON and returned a union selected by a boolean argument. `GarminClient.get(schema, path, signal)` now infers and validates its response type from the supplied schema. `download(path, signal)` has a separate file return type. An internal schema-first fetch function handles the shared bounded JSON read. Following the user’s preference, this small implementation stays inline; `zod-fetch` is not a dependency.

Every MCP tool returns the same envelope in `structuredContent` and serialized text. Per the user's preference, response schemas stay inside the Garmin client rather than being advertised as MCP output schemas. The SDK handles protocol negotiation, input validation, and transport; the Garmin client validates upstream responses. Read-only annotations and consent-based tool exposure remain in place. MCP cancellation reaches both the Garmin token exchange and the data request. Upstream HTTP errors and response validation failures leave the application only as fixed, actionable messages; payloads and Zod issues are not logged or returned.

TypeScript now checks indexed access, exact optional properties, overrides, switch fallthrough, and return paths in application code, configuration, and tests. Cookie parsing in the tests explicitly checks that the expected value exists. The main compiler is pinned to 7.1.0-beta, including the stricter checks; it has passed type checking with these changes.

## Generated response contracts

The response schemas come from Garmin’s checked-in OpenAPI snapshot through the maintained `@hey-api/openapi-ts` Zod plugin. This dependency was chosen to handle OpenAPI references, nested definitions, enums, and nullability without writing another schema interpreter. Generation uses the tool’s native configuration and Oxfmt postprocessor, not a custom script.

Run `pnpm run generate:api` to regenerate the models. The generator lives in the `codegen` workspace because its existing JavaScript compiler API dependency requires TypeScript 6. TypeScript 7.1 exposes a new API through different entry points; upgrading the application compiler does not migrate the generator’s implementation.

The configuration makes three deliberate choices:

- JSON `int64` fields remain safe JavaScript integers. Values outside that range fail validation instead of being coerced into non-JSON `bigint` values.
- Objects preserve additional Garmin fields while validating documented fields. Optionality and nullability follow the published schema; absent health metrics are not filled with invented values.
- Date-time validation accepts local timestamps and timezone offsets. Dates remain strings rather than being converted into JavaScript `Date` objects.

## Boundaries retained after review

`src/index.ts` retains canonical-origin checking, resource-bound OAuth validation, and per-request MCP construction. Its two documented assertions bridge the OAuth library’s injected environment and resource context; they do not assert types for untrusted JSON.

`src/auth.ts` continues to use Cloudflare’s browser-bound, single-use consent helpers, verifies the Garmin key before grant storage, and stores it through the library’s encrypted grant properties. `src/pages.ts` escapes client-controlled text and retains the existing browser security headers. `src/scopes.ts` and `src/garmin-error.ts` remain small domain definitions. These modules did not need a new abstraction or a broad rewrite.

The application still uses one Worker, a dedicated OAuth KV namespace, and request-local Garmin credentials. Response sizes and timeouts stay bounded. Generated models add validation code, but no new runtime package was added.

## Validation and limits

The Workers test suite covers the full OAuth lifecycle with the real MCP SDK, all published input contracts, schema-derived TypeScript results, malformed responses, preservation of additional fields, stream cancellation, and safe errors. Build verification checks the actual Worker bundle.

Mocked tests cannot establish whether Garmin’s published models match every real-account response. Live reads still require a real Personal API key entered through browser consent. A schema mismatch now fails explicitly with a redacted tool error, so it cannot silently become a falsely typed result.

## Research sources

- [MCP tools specification, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): structured content, tool errors, and annotations. The implementation also retains a JSON text result for older clients.
- [MCP TypeScript SDK cancellation guidance](https://ts.sdk.modelcontextprotocol.io/v2/servers/logging-progress-cancellation): pass the request’s cancellation signal into upstream work.
- [Google’s code review guidance](https://google.github.io/eng-practices/review/reviewer/looking-for.html): review design and complexity, avoid speculative generality, and use comments to explain decisions.
- [Google’s TypeScript style guide](https://google.github.io/styleguide/tsguide.html): prefer simple type constructs and justify type assertions. This audit applies that design guidance while retaining the repository’s own formatting rules.
- [TypeScript indexed access](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html) and [exact optional properties](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html): make absent values visible in the type system.
- [TypeScript 7.1 beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/): the new compiler API entry points and stricter type checks.
- [Zod schemas](https://zod.dev/api) and [JSON Schema conversion](https://zod.dev/json-schema): use native validation and JSON Schema generation. The experimental JSON-Schema-to-Zod API was not used to interpret OpenAPI at runtime.
- [Hey API’s Zod plugin](https://heyapi.dev/docs/openapi/typescript/plugins/zod), [resolvers](https://heyapi.dev/docs/openapi/typescript/plugins/concepts/resolvers), and [output configuration](https://heyapi.dev/docs/openapi/typescript/configuration/output): maintained generation with explicit JSON compatibility choices.
- [zod-fetch](https://github.com/mattpocock/zod-fetch): the small schema-first fetch concept requested by the user.
