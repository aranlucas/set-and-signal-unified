# MCP domain Events research

Checked **2026-10-24** against primary sources. Scope: protocol maturity, the repo’s pinned TypeScript packages, and documented host compatibility. No implementation or live host integration was tested.

Subsequent implementation follows the DIGITS webhook pattern; see [Garmin MCP Events](mcp-events.md) for the current behavior and validation scope.

## Finding

MCP domain Events is an **experimental draft with a documented ChatGPT integration**, not a generally supported core feature. The working group explicitly disclaims official specification status. Its repository currently contains documentation rather than a reference implementation; the checked revision is [`d5316be` (2026-10-09)](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/tree/d5316be214be2e76e51462069c1d67e00a5a7619). Experimental repositories graduate through the Extensions Track SEP process. [Working-group README](https://github.com/modelcontextprotocol/experimental-ext-triggers-events#readme), [extension lifecycle](https://modelcontextprotocol.io/extensions/overview).

## Proposed protocol

The [design sketch](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/d5316be214be2e76e51462069c1d67e00a5a7619/docs/design-sketch-proposal.md) proposes:

- `capabilities.events`, with optional `listChanged`; `events/list` returns event descriptors containing `name`, `inputSchema`, `payloadSchema`, and supported `delivery` modes.
- `events/poll`: `{name, arguments, cursor}` → events, updated cursor, polling guidance. No separate subscribe call.
- `events/stream`: long-lived push request; `notifications/events/event` carries occurrences. Companion notifications are `active`, `heartbeat`, `error`, and `terminated` under `notifications/events/`.
- `events/subscribe`: create/refresh an HTTPS webhook subscription, with client-supplied signing secret and negotiated expiration. `events/unsubscribe` removes it.
- `notifications/events/list_changed`: rediscover event definitions.
- Occurrences: `{eventId, name, timestamp, data, cursor}`. Opaque cursors support replay where available; `eventId` supports deduplication, `maxAgeMs` bounds replay, and `truncated` signals skipped history. Delivery reliability depends on the upstream.

No delivery mode is mandatory. The client owns its subscription registry; no server-side listing method is proposed. SDK examples such as `server.event()` and `server.emit()` describe intended APIs, not evidence of released TypeScript support. These names and contracts remain provisional. [Design sketch](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/d5316be214be2e76e51462069c1d67e00a5a7619/docs/design-sketch-proposal.md).

## Official TypeScript SDK: what exists

The repo pins `@modelcontextprotocol/server` **2.3.1**, `@modelcontextprotocol/client` **2.3.1**, and `@modelcontextprotocol/hono` **2.0.2**. (`hono` itself is **4.13.13**.) There was no installed `node_modules` tree in this checkout, so inspection used the publisher’s exact npm tarballs, in memory. Their runtime/declaration files contain no `events/list`, `events/poll`, `events/stream`, `events/subscribe`, `notifications/events/*`, or `registerEvent` implementation. This is a bounded package inspection, not a claim that no experimental implementation exists anywhere. [Local manifest](../package.json), [server artifact](https://registry.npmjs.org/@modelcontextprotocol/server/-/server-2.3.1.tgz), [client artifact](https://registry.npmjs.org/@modelcontextprotocol/client/-/client-2.3.1.tgz), [Hono adapter artifact](https://registry.npmjs.org/@modelcontextprotocol/hono/-/hono-2.0.2.tgz).

The SDK does support custom JSON-RPC handlers with explicit schemas and generic extension capability advertisement. Those are building blocks for an adapter, not a domain Events implementation. [Official custom-methods example](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/examples/custom-methods), [extension-capability example](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/examples/extension-capabilities).

`ServerEventBus` is specifically typed for tool/prompt/resource list changes and individual resource updates; it routes these onto `subscriptions/listen`. It provides no arbitrary `workout.finished` event contract. An internal emitter or bus must not be presented as support for the Events draft. [Official bus source](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/serverEventBus.ts).

## Existing protocol primitives are separate

- **Resources and notifications:** In current MCP **2026-07-28**, a client opens `subscriptions/listen` with `notifications.resourceSubscriptions`; `notifications/resources/updated` identifies a changed URI. The client can read its representation with `resources/read`. List-change notifications describe catalog changes. These are existing core capabilities, without the draft’s domain event schemas and replay contract. [Current resources specification](https://modelcontextprotocol.io/specification/2026-07-28/server/resources).
- **Version distinction:** MCP **2025-11-25** used `resources/subscribe` / `resources/unsubscribe`. Current Streamable HTTP removed GET notification streams and protocol sessions; long-lived notifications use a POST `subscriptions/listen` response. Do not mix examples across these revisions. [Older resources specification](https://modelcontextprotocol.io/specification/2025-11-25/server/resources), [current transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).
- **Tasks:** The current Tasks extension represents execution of an MCP request through a durable task handle, `tasks/get`, `tasks/update`, and `tasks/cancel`; optional `notifications/tasks` use `subscriptions/listen`. This is different from observing an independently completed physical workout. The 2025 task specification was explicitly experimental; describe the revision being used. [Current Tasks documentation](https://modelcontextprotocol.io/extensions/tasks/overview), [2025 Tasks specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks).

## Practical host compatibility

OpenAI documents Events in **ChatGPT Work on web**, **desktop Work with Cloud selected**, and **dots**, requiring MCP **2026-07-28**, persistent subscriptions, and outbound HTTPS. It supports **webhooks and callback verification**, excluding poll, stream, `gap`, and `terminated` controls. Advertise `events` in `server/discover` and implement `events/list`, `events/subscribe`, and `events/unsubscribe` on the authenticated MCP endpoint. Delivery uses Standard Webhooks signatures; the documentation recommends the `standardwebhooks` library. [ChatGPT integration guide](https://developers.openai.com/plugins/build/mcp-events).

Compatibility discrepancy: that guide still names callback error **`-32015`**, while the latest working-group sketch renumbers it **`-32027`**, provisionally. Resolve this against the target host before implementation. The official extension matrix has no Events column; its omission cannot establish that a particular host lacks an experimental integration. No Claude, Cursor, VS Code, or T3 Events compatibility was verified here. [Integration guide](https://developers.openai.com/plugins/build/mcp-events#verify-the-callback), [draft error codes](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/d5316be214be2e76e51462069c1d67e00a5a7619/docs/design-sketch-proposal.md#error-codes), [official extension matrix](https://modelcontextprotocol.io/extensions/client-matrix).

## Garmin boundary and implementation implications

**Upstream Garmin delivery** brings data into this service; **downstream MCP Events delivery** sends a normalized occurrence to a subscribed host. Their subscription records, credentials, callbacks, and acknowledgment behavior are separate. Garmin’s Personal tier is pull-only; Business Starter is push-only and Enterprise offers push or ping/pull. Therefore downstream webhook delivery does not require Garmin itself to provide an upstream webhook. [Garmin program overview](https://developer.garmin.com/gc-developer-program).

Garmin activity data becomes available after device synchronization. A defensible first event is therefore an application-defined `activity.synced` or `workout.finished` explicitly described as “a completed activity was first observed after sync,” rather than an instantaneous watch-stop signal. [Garmin Enterprise Activity API](https://developer.garmin.com/gc-developer-program/enterprise/activity-api/).

Engineering inference: a pull-based upstream needs a detector independent of interactive MCP requests, persisted observation/deduplication state, and downstream subscription/delivery handling. A subscribed resource can expose changed activity data to an already listening client, but does not establish that a host will wake an agent. For an initial Events implementation, target the documented host’s webhook subset and validate discovery, subscribe/verification, delivery, refresh, and unsubscribe end to end. Additional Garmin event selection and data availability belong to the separate Garmin investigation.
