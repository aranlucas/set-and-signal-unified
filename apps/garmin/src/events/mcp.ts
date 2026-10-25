import {
  ProtocolError,
  type McpServer,
  type ServerCapabilities,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GarminUserData } from "../push/store";
import type { TrainingClient } from "../training/client";
import {
  eventCodes,
  eventDefinitions,
  eventPermission,
  subscribeParams,
  unsubscribeParams,
  unwrapEventReply,
  type EventOwner,
} from "./protocol";

interface EventsCapabilities extends ServerCapabilities {
  events: Record<string, never>;
}

/** SDK custom-method registration mirrors DIGITS' documented webhook profile. */
export function registerEvents(
  server: McpServer,
  store: DurableObjectStub<GarminUserData>,
  owner: EventOwner,
  client: TrainingClient,
) {
  const capabilities: EventsCapabilities = { events: {} };
  server.server.registerCapabilities(capabilities);
  server.server.setRequestHandler(
    "events/list",
    { params: z.object({ cursor: z.string().optional() }) },
    async (params, ctx) => {
      if (params.cursor !== undefined) {
        throw new ProtocolError(eventCodes.invalid, "Unknown event catalog cursor.");
      }

      if (await store.isRevoked()) {
        return { events: [] };
      }

      const permissions = await client.getPermissions(ctx.mcpReq.signal);

      return {
        events: eventDefinitions.filter((event) =>
          permissions.includes(eventPermission(event.name)),
        ),
      };
    },
  );
  server.server.setRequestHandler("events/subscribe", { params: subscribeParams }, async (params) =>
    unwrapEventReply(await store.subscribeEvent(owner, params)),
  );
  server.server.setRequestHandler(
    "events/unsubscribe",
    { params: unsubscribeParams },
    async (params) => unwrapEventReply(await store.unsubscribeEvent(owner, params)),
  );
}
