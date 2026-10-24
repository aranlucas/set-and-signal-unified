import type { EventName } from "./protocol";

export interface IngestDiagnostic {
  event: "mcp_event_ingest";
  name: EventName;
  event_id: string;
  source: string;
  outcome:
    | "duplicate"
    | "import"
    | "manual"
    | "invalid_summary"
    | "permission_withdrawn"
    | "no_subscriptions"
    | "filtered"
    | "queued";
  subscriptions: number;
  deliveries: number;
}

export type DeliveryOutcome =
  | "delivered"
  | "http_4xx"
  | "http_5xx"
  | "transport_error"
  | "authorization_unavailable"
  | "subscription_changed"
  | "subscription_unavailable"
  | "access_revoked"
  | "invalid_secret"
  | "payload_unavailable"
  | "retry_exhausted"
  | "deadline_exceeded";

type Diagnostic =
  | IngestDiagnostic
  | {
      event:
        | "mcp_event_subscription_created"
        | "mcp_event_subscription_refreshed"
        | "mcp_event_subscription_deleted";
      subscription: string;
      name: EventName;
      reason?: "unsubscribe" | "expired" | "access_revoked" | "invalid_secret" | "cleared";
    }
  | {
      event: "mcp_event_webhook" | "mcp_event_delivery_retry" | "mcp_event_delivery_finished";
      event_id: string;
      subscription: string;
      attempt: number;
      outcome: DeliveryOutcome;
      status?: number;
    };

/** Only domain diagnostics: never accept raw payloads, URLs, identities, or errors. */
export function logEvent(fields: Diagnostic) {
  // oxlint-disable-next-line no-console -- Workers Logs receives only the typed, redacted diagnostic.
  console.info(JSON.stringify(fields));
}
