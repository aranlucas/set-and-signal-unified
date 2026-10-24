import { ProtocolError } from "@modelcontextprotocol/server";
import { z } from "zod";

// Match the ChatGPT webhook profile used by DIGITS; the later WG draft renumbers these.
export const eventCodes = {
  invalid: -32602,
  missing: -32011,
  forbidden: -32012,
  exhausted: -32013,
  unsupported: -32014,
  callback: -32015,
} as const;

export const eventName = z.enum([
  "garmin.activity.completed",
  "garmin.sleep.available",
  "garmin.body_composition.recorded",
]);

export type EventName = z.infer<typeof eventName>;

export interface EventOwner {
  subject: string;
  garminUserId: string;
}

export const activityFilters = z.strictObject({
  activityTypes: z.array(z.string().min(1).max(100)).min(1).max(32).optional(),
  minDurationSeconds: z.number().min(0).max(604800).optional(),
});

export const subscribeParams = z.object({
  name: z.string().min(1).max(200),
  arguments: z.record(z.string(), z.unknown()).default({}),
  delivery: z.object({
    mode: z.string().max(32),
    url: z.string().max(2048),
    secret: z.string().max(256),
  }),
  cursor: z.string().max(4096).nullable().optional(),
  maxAgeMs: z.number().int().nonnegative().optional(),
  ttlMs: z.number().int().nonnegative().nullable().optional(),
});

export const unsubscribeParams = subscribeParams.pick({ name: true, arguments: true }).extend({
  delivery: z.object({ mode: z.string().optional(), url: z.string().max(2048) }),
});

export type SubscribeParams = z.infer<typeof subscribeParams>;

export type UnsubscribeParams = z.infer<typeof unsubscribeParams>;

export function knownEvent(value: string): EventName {
  const parsed = eventName.safeParse(value);

  if (!parsed.success) {
    throw new ProtocolError(eventCodes.missing, "Unknown Garmin event.");
  }

  return parsed.data;
}

export function eventPermission(name: EventName) {
  return name === "garmin.activity.completed" ? "ACTIVITY_EXPORT" : "HEALTH_EXPORT";
}

/** Fixed domain fields in fixed order, so filter spelling/order cannot duplicate a subscription. */
export function canonicalFilters(name: EventName, args: SubscribeParams["arguments"]): string {
  const parsed = (
    name === "garmin.activity.completed" ? activityFilters : z.strictObject({})
  ).safeParse(args);

  if (!parsed.success) {
    throw new ProtocolError(eventCodes.invalid, "Invalid Garmin event filters.");
  }

  const filters = activityFilters.parse(parsed.data);
  const canonical: z.infer<typeof activityFilters> = {};

  if (filters.activityTypes) {
    canonical.activityTypes = [
      ...new Set(filters.activityTypes.map((type) => type.toUpperCase())),
    ].toSorted();
  }

  if (filters.minDurationSeconds !== undefined) {
    canonical.minDurationSeconds = filters.minDurationSeconds;
  }

  return JSON.stringify(canonical);
}

// Provider fields are optional: absence never becomes a fabricated zero measurement.
export const activityMetrics = z.object({
  activityName: z.string().max(500).optional(),
  activityType: z.string().max(100).optional(),
  startTimeInSeconds: z.number().int().nonnegative().optional(),
  durationInSeconds: z.number().nonnegative().optional(),
  distanceInMeters: z.number().nonnegative().optional(),
  averageHeartRateInBeatsPerMinute: z.number().nonnegative().optional(),
  maxHeartRateInBeatsPerMinute: z.number().nonnegative().optional(),
});

export const summaryTiming = activityMetrics.pick({
  startTimeInSeconds: true,
  durationInSeconds: true,
});

export const eventData = activityMetrics.extend({
  type: z.enum(["activities", "sleeps", "bodyComps"]),
  summaryId: z.string(),
  calendarDate: z.string(),
  receivedAt: z.iso.datetime(),
});

const payloadSchema = z.toJSONSchema(eventData);

export const eventDefinitions = [
  {
    name: "garmin.activity.completed" as const,
    title: "Workout finished",
    description:
      "A new recorded activity was received after syncing to Garmin Connect. Sync may be delayed. Delivered to subscriptions active at receipt; no historical replay. Imports, edits, Move IQ, and later detail deliveries do not trigger completion. Read details with get_garmin_summary.",
    inputSchema: z.toJSONSchema(activityFilters),
  },
  {
    name: "garmin.sleep.available" as const,
    title: "Sleep summary available",
    description:
      "A new sleep episode summary was received after Garmin sync. Later revisions of the same episode do not trigger another event. No historical replay. Read measurements with get_garmin_summary; if the summary was superseded, use list_garmin_summaries for its calendarDate and start time.",
    inputSchema: z.toJSONSchema(z.strictObject({})),
  },
  {
    name: "garmin.body_composition.recorded" as const,
    title: "Body composition recorded",
    description:
      "A new body composition measurement was received after Garmin sync. No historical replay. Read measurements with get_garmin_summary.",
    inputSchema: z.toJSONSchema(z.strictObject({})),
  },
].map((definition) => ({ ...definition, delivery: ["webhook"], payloadSchema }));

export type EventReply<T> =
  | { ok: true; result: T }
  | { ok: false; code: number; message: string; data: { reason?: string | undefined } };

/** Preserve safe protocol errors across the Durable Object RPC boundary. */
export async function eventReply<T>(operation: () => T | Promise<T>): Promise<EventReply<T>> {
  try {
    return { ok: true, result: await operation() };
  } catch (error) {
    return error instanceof ProtocolError
      ? {
          ok: false,
          code: error.code,
          message: error.message,
          data: z.object({ reason: z.string().optional() }).safeParse(error.data).data ?? {},
        }
      : { ok: false, code: -32603, message: "Garmin event service is unavailable.", data: {} };
  }
}

export function unwrapEventReply<T>(reply: EventReply<T>): T {
  if (!reply.ok) {
    throw new ProtocolError(reply.code, reply.message, reply.data);
  }

  return reply.result;
}
