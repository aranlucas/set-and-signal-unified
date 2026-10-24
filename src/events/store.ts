import { createHash } from "node:crypto";
import { ProtocolError } from "@modelcontextprotocol/server";
import { z } from "zod";
import { garminCredential, type AuthBroker } from "../auth";
import { TrainingClient } from "../training/client";
import { GarminError } from "../garmin-error";
import { logEvent, type DeliveryOutcome, type IngestDiagnostic } from "./diagnostics";
import type { StoredSummary } from "../push/store";
import {
  activityFilters,
  activityMetrics,
  canonicalFilters,
  eventCodes,
  eventData,
  eventPermission,
  knownEvent,
  summaryTiming,
  type EventName,
  type EventOwner,
  type SubscribeParams,
  type UnsubscribeParams,
} from "./protocol";
import {
  callbackUrl,
  openSecret,
  sealSecret,
  validWebhookSecret,
  verifyCallback,
  postWebhook,
} from "./webhook";

const MINUTE = 60_000;

const DAY = 24 * 60 * MINUTE;

const RETRY_WINDOW = 15 * MINUTE;

type SubscriptionRow = {
  id: string;
  owner: string;
  garmin_id: string;
  name: EventName;
  args: string;
  callback: string;
  secret: string;
  previous_secret: string | null;
  previous_until: number;
  expires_at: number;
  created_at: number;
  version: string;
};

type DeliveryRow = {
  event_id: string;
  subscription_id: string;
  attempts: number;
  deadline: number;
  next_at: number;
};

type Access = "allowed" | "denied" | "unavailable";

type EpochRow = { epoch: number };

type CountRow = { count: number };

type VerificationRow = { verifications: number };

type NextRow = { next: number | null };

type BodyRow = { body: string };

type VerificationExpiryRow = { expires_at: number };

type SubscriptionIdentity = Pick<SubscriptionRow, "id" | "name">;

function hash(parts: string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** SQL state is scoped to the existing immutable-account Durable Object. */
export class GarminEvents {
  private readonly sql: SqlStorage;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
    private readonly blocked: (name: EventName) => boolean,
    private readonly nextFileExpiry: () => number | null = () => null,
  ) {
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS event_control (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL, window INTEGER NOT NULL, verifications INTEGER NOT NULL)",
    );
    this.sql.exec("INSERT OR IGNORE INTO event_control VALUES (1,0,0,0)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS event_verifications (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS event_subscriptions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, garmin_id TEXT NOT NULL, name TEXT NOT NULL, args TEXT NOT NULL, callback TEXT NOT NULL, secret TEXT NOT NULL, previous_secret TEXT, previous_until INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, version TEXT NOT NULL)",
    );
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS event_subscriptions_expiry ON event_subscriptions(expires_at)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS event_occurrences (id TEXT PRIMARY KEY, name TEXT NOT NULL, body TEXT NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS event_deliveries (event_id TEXT NOT NULL, subscription_id TEXT NOT NULL, attempts INTEGER NOT NULL, deadline INTEGER NOT NULL, next_at INTEGER NOT NULL, PRIMARY KEY(event_id,subscription_id))",
    );
    this.sql.exec("CREATE INDEX IF NOT EXISTS event_deliveries_due ON event_deliveries(next_at)");
  }

  private epoch(): number {
    return this.sql.exec<EpochRow>("SELECT epoch FROM event_control WHERE id=1").one().epoch;
  }

  private invalidate() {
    this.sql.exec("UPDATE event_control SET epoch=epoch+1 WHERE id=1");
    this.sql.exec("DELETE FROM event_verifications");
  }

  private subscription(id: string): SubscriptionRow | undefined {
    return this.sql
      .exec<SubscriptionRow>("SELECT * FROM event_subscriptions WHERE id=?", id)
      .toArray()[0];
  }

  private async access(owner: EventOwner, name: EventName): Promise<Access> {
    if (this.blocked(name)) {
      return "denied";
    }

    try {
      // SAFETY: AUTH is the private GarminTokens entrypoint; validate every RPC reply.
      const broker = this.env.AUTH as AuthBroker;
      const result = await broker.accessToken(owner.subject);

      if (result === null) {
        return "denied";
      }

      const credential = garminCredential.safeParse(result);

      if (!credential.success || credential.data.expiresAt <= Date.now()) {
        return "unavailable";
      }

      if (credential.data.garminUserId !== owner.garminUserId) {
        return "denied";
      }

      const permissions = await new TrainingClient(credential.data.accessToken).getPermissions();

      return permissions.includes(eventPermission(name)) && !this.blocked(name)
        ? "allowed"
        : "denied";
    } catch (error) {
      if (error instanceof GarminError && [401, 403, 412].includes(error.status)) {
        return "denied";
      }

      return "unavailable";
    }
  }

  private async requireAccess(owner: EventOwner, name: EventName) {
    const access = await this.access(owner, name);

    if (access !== "allowed") {
      throw new ProtocolError(
        access === "denied" ? eventCodes.forbidden : -32603,
        access === "denied"
          ? "Garmin event permission is unavailable. Reconnect Garmin."
          : "Garmin event authorization is temporarily unavailable.",
      );
    }
  }

  private checkCapacity(id: string) {
    if (
      !this.subscription(id) &&
      this.sql.exec<CountRow>("SELECT count(*) AS count FROM event_subscriptions").one().count >= 50
    ) {
      throw new ProtocolError(
        eventCodes.exhausted,
        "Garmin account has reached its event subscription limit.",
      );
    }
  }

  async subscribe(owner: EventOwner, params: SubscribeParams) {
    const name = knownEvent(params.name);

    if (
      params.delivery.mode !== "webhook" ||
      (params.cursor !== undefined && params.cursor !== null)
    ) {
      throw new ProtocolError(
        eventCodes.unsupported,
        "Garmin events support webhook delivery without cursor replay.",
      );
    }

    const args = canonicalFilters(name, params.arguments);
    const url = callbackUrl(params.delivery.url);

    if (!validWebhookSecret(params.delivery.secret)) {
      throw new ProtocolError(eventCodes.invalid, "Invalid webhook signing secret.");
    }

    const epoch = this.epoch();
    await this.requireAccess(owner, name);
    this.cleanup();
    const id = `sub_${hash([owner.subject, owner.garminUserId, name, url, args])}`;
    this.checkCapacity(id);

    // Include the signing key: a rotation must prove the callback accepts its new key.
    const verificationId = hash([
      owner.subject,
      owner.garminUserId,
      url,
      hash([params.delivery.secret]),
    ]);

    const verified = this.sql
      .exec<VerificationExpiryRow>(
        "SELECT expires_at FROM event_verifications WHERE id=? AND expires_at>?",
        verificationId,
        Date.now(),
      )
      .toArray()[0];

    let verifiedUntil = verified?.expires_at;

    if (verifiedUntil === undefined) {
      const window = Math.floor(Date.now() / MINUTE);
      this.sql.exec(
        "UPDATE event_control SET verifications=CASE WHEN window=? THEN verifications+1 ELSE 1 END,window=? WHERE id=1",
        window,
        window,
      );

      if (
        this.sql.exec<VerificationRow>("SELECT verifications FROM event_control WHERE id=1").one()
          .verifications > 10
      ) {
        throw new ProtocolError(
          eventCodes.exhausted,
          "Too many callback verifications. Try again in a minute.",
        );
      }

      await verifyCallback(url, id, params.delivery.secret);
      verifiedUntil = Date.now() + 5 * MINUTE;
    }

    const sealed = await sealSecret(params.delivery.secret, this.env.GARMIN_PUSH_TOKEN);
    await this.requireAccess(owner, name);
    // Persist a wake-up before activating state. If execution stops after the SQL
    // commit, the alarm can still clean up or deliver without another request.
    await this.ctx.storage.setAlarm(Date.now() + 1000);

    if (epoch !== this.epoch()) {
      throw new ProtocolError(
        eventCodes.forbidden,
        "Event access changed during subscription. Try subscribing again.",
      );
    }

    this.cleanup();
    this.checkCapacity(id);
    const now = Date.now();
    const previous = this.subscription(id);
    this.sql.exec(
      "INSERT OR REPLACE INTO event_verifications VALUES (?,?)",
      verificationId,
      verifiedUntil,
    );

    const expires =
      now +
      Math.max(
        5 * MINUTE,
        Math.min(7 * DAY, params.ttlMs === null ? 7 * DAY : (params.ttlMs ?? DAY)),
      );

    this.sql.exec(
      "INSERT OR REPLACE INTO event_subscriptions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      owner.subject,
      owner.garminUserId,
      name,
      args,
      url,
      sealed,
      previous?.secret ?? null,
      previous ? now + 10 * MINUTE : 0,
      expires,
      previous?.created_at ?? now,
      crypto.randomUUID(),
    );
    await this.schedule();

    logEvent({
      event: previous ? "mcp_event_subscription_refreshed" : "mcp_event_subscription_created",
      subscription: id,
      name,
    });

    return { id, refreshBefore: new Date(expires).toISOString(), cursor: null, truncated: false };
  }

  async unsubscribe(owner: EventOwner, params: UnsubscribeParams) {
    const name = knownEvent(params.name);
    const args = canonicalFilters(name, params.arguments);
    const url = callbackUrl(params.delivery.url);
    const id = `sub_${hash([owner.subject, owner.garminUserId, name, url, args])}`;
    this.invalidate();

    const deleted = this.sql
      .exec(
        "DELETE FROM event_subscriptions WHERE id=? AND owner=? RETURNING id",
        id,
        owner.subject,
      )
      .toArray();

    this.cleanup();
    await this.schedule();

    if (deleted.length) {
      logEvent({
        event: "mcp_event_subscription_deleted",
        subscription: id,
        name,
        reason: "unsubscribe",
      });
    }

    return {};
  }

  /** Invoked synchronously inside the summary-ingestion transaction; no external I/O. */
  enqueue(row: StoredSummary, known: boolean): IngestDiagnostic | undefined {
    const names = {
      activities: "garmin.activity.completed",
      sleeps: "garmin.sleep.available",
      bodyComps: "garmin.body_composition.recorded",
      healthSnapshot: "garmin.health_snapshot.available",
    } as const;

    const type = eventData.shape.type.safeParse(row.type);

    if (!type.success) {
      return;
    }

    const name = names[type.data];
    const id = `evt_${hash([this.ctx.id.toString(), name, String(row.startTime ?? row.summaryId)])}`;

    const diagnostic: IngestDiagnostic = {
      event: "mcp_event_ingest",
      name,
      event_id: id,
      source: hash([row.type, row.summaryId]),
      outcome: "duplicate",
      subscriptions: 0,
      deliveries: 0,
    };

    if (known) {
      return diagnostic;
    }

    const source = z
      .object({ importSource: z.string().optional(), isManual: z.boolean().optional() })
      .safeParse(JSON.parse(row.data));

    if (!source.success || source.data.importSource || source.data.isManual) {
      return {
        ...diagnostic,
        outcome: !source.success
          ? "invalid_summary"
          : source.data.importSource
            ? "import"
            : "manual",
      };
    }

    if (this.blocked(name)) {
      return { ...diagnostic, outcome: "permission_withdrawn" };
    }

    const metrics =
      (type.data === "activities" ? activityMetrics : summaryTiming).safeParse(JSON.parse(row.data))
        .data ?? {};

    const data = eventData.parse({
      ...metrics,
      type: type.data,
      summaryId: row.summaryId,
      calendarDate: row.date,
      receivedAt: new Date(row.receivedAt).toISOString(),
    });

    const subscriptions = this.sql
      .exec<SubscriptionRow>(
        "SELECT * FROM event_subscriptions WHERE name=? AND created_at<=? AND expires_at>?",
        name,
        row.receivedAt,
        Date.now(),
      )
      .toArray();

    const body = JSON.stringify({
      eventId: id,
      name,
      timestamp: data.receivedAt,
      data,
      cursor: null,
    });

    for (const subscription of subscriptions) {
      const filters = activityFilters.parse(JSON.parse(subscription.args));

      if (
        filters.activityTypes &&
        (!data.activityType || !filters.activityTypes.includes(data.activityType.toUpperCase()))
      ) {
        continue;
      }

      if (
        filters.minDurationSeconds !== undefined &&
        (data.durationInSeconds === undefined ||
          data.durationInSeconds < filters.minDurationSeconds)
      ) {
        continue;
      }

      this.sql.exec("INSERT OR IGNORE INTO event_occurrences VALUES (?,?,?)", id, name, body);
      diagnostic.deliveries += this.sql
        .exec(
          "INSERT OR IGNORE INTO event_deliveries VALUES (?,?,0,?,?) RETURNING event_id",
          id,
          subscription.id,
          Date.now() + RETRY_WINDOW,
          Date.now() + 1000,
        )
        .toArray().length;
    }

    return {
      ...diagnostic,
      subscriptions: subscriptions.length,
      outcome: diagnostic.deliveries
        ? "queued"
        : subscriptions.length
          ? "filtered"
          : "no_subscriptions",
    };
  }

  clear(permission?: string) {
    this.invalidate();

    const deleted = permission
      ? this.sql
          .exec<SubscriptionIdentity>(
            "DELETE FROM event_subscriptions WHERE (?='ACTIVITY_EXPORT' AND name='garmin.activity.completed') OR (?<>'ACTIVITY_EXPORT' AND name<>'garmin.activity.completed') RETURNING id,name",
            permission,
            permission,
          )
          .toArray()
      : this.sql
          .exec<SubscriptionIdentity>("DELETE FROM event_subscriptions RETURNING id,name")
          .toArray();

    for (const row of deleted) {
      logEvent({
        event: "mcp_event_subscription_deleted",
        subscription: row.id,
        name: row.name,
        reason: permission ? "access_revoked" : "cleared",
      });
    }

    this.cleanup();
  }

  async prepareIngest() {
    if (
      this.sql
        .exec("SELECT id FROM event_subscriptions WHERE expires_at>? LIMIT 1", Date.now())
        .toArray().length > 0
    ) {
      // An early harmless wake-up is preferable to a committed outbox with no alarm.
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }

  private cleanup() {
    const now = Date.now();

    const expired = this.sql
      .exec<SubscriptionIdentity>(
        "DELETE FROM event_subscriptions WHERE expires_at<=? RETURNING id,name",
        now,
      )
      .toArray();

    for (const row of expired) {
      logEvent({
        event: "mcp_event_subscription_deleted",
        subscription: row.id,
        name: row.name,
        reason: "expired",
      });
    }

    this.sql.exec(
      "DELETE FROM event_verifications WHERE expires_at<=? OR NOT EXISTS (SELECT 1 FROM event_subscriptions)",
      now,
    );
    this.sql.exec(
      "UPDATE event_subscriptions SET previous_secret=NULL,previous_until=0 WHERE previous_secret IS NOT NULL AND previous_until<=?",
      now,
    );

    const discarded = this.sql
      .exec<DeliveryRow>(
        "DELETE FROM event_deliveries WHERE deadline<=? OR subscription_id NOT IN (SELECT id FROM event_subscriptions) RETURNING *",
        now,
      )
      .toArray();

    for (const job of discarded) {
      logEvent({
        event: "mcp_event_delivery_finished",
        event_id: job.event_id,
        subscription: job.subscription_id,
        attempt: job.attempts,
        outcome: job.deadline <= now ? "deadline_exceeded" : "subscription_unavailable",
      });
    }

    this.sql.exec(
      "DELETE FROM event_occurrences WHERE id NOT IN (SELECT event_id FROM event_deliveries)",
    );
  }

  async schedule() {
    const nextEvent = this.sql
      .exec<NextRow>(
        "SELECT min(at) AS next FROM (SELECT min(next_at) AS at FROM event_deliveries UNION ALL SELECT min(deadline) FROM event_deliveries UNION ALL SELECT min(expires_at) FROM event_subscriptions UNION ALL SELECT min(expires_at) FROM event_verifications UNION ALL SELECT min(previous_until) FROM event_subscriptions WHERE previous_secret IS NOT NULL)",
      )
      .one().next;

    const candidates = [nextEvent, this.nextFileExpiry()].filter((time) => time !== null);
    const next = candidates.length ? Math.min(...candidates) : null;

    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next));
    }
  }

  async alarm() {
    // Set a recovery alarm before external I/O; an unexpected crash cannot strand the outbox.
    await this.ctx.storage.setAlarm(Date.now() + MINUTE);
    this.cleanup();

    const jobs = this.sql
      .exec<DeliveryRow>(
        "SELECT * FROM event_deliveries WHERE next_at<=? ORDER BY next_at LIMIT 10",
        Date.now(),
      )
      .toArray();

    await Promise.all(jobs.map((job) => this.deliver(job)));
    this.cleanup();
    await this.schedule();
  }

  private finish(job: DeliveryRow, outcome: DeliveryOutcome) {
    const removed = this.sql
      .exec(
        "DELETE FROM event_deliveries WHERE event_id=? AND subscription_id=? RETURNING event_id",
        job.event_id,
        job.subscription_id,
      )
      .toArray();

    if (removed.length) {
      logEvent({
        event: "mcp_event_delivery_finished",
        event_id: job.event_id,
        subscription: job.subscription_id,
        attempt: job.attempts,
        outcome,
      });
    }
  }

  private retry(job: DeliveryRow, outcome: DeliveryOutcome) {
    if (job.attempts >= 4 || job.deadline <= Date.now()) {
      this.finish(
        { ...job, attempts: job.attempts + 1 },
        job.deadline <= Date.now() ? "deadline_exceeded" : "retry_exhausted",
      );

      return;
    }

    const delay = Math.round(
      Math.min(5 * MINUTE, 5000 * 2 ** job.attempts) * (0.8 + Math.random() * 0.4),
    );

    const updated = this.sql
      .exec(
        "UPDATE event_deliveries SET attempts=attempts+1,next_at=? WHERE event_id=? AND subscription_id=? RETURNING event_id",
        Date.now() + delay,
        job.event_id,
        job.subscription_id,
      )
      .toArray();

    if (updated.length) {
      logEvent({
        event: "mcp_event_delivery_retry",
        event_id: job.event_id,
        subscription: job.subscription_id,
        attempt: job.attempts + 1,
        outcome,
      });
    }
  }

  private async deliver(job: DeliveryRow) {
    const subscription = this.subscription(job.subscription_id);

    if (!subscription || subscription.expires_at <= Date.now()) {
      this.finish(job, "subscription_unavailable");

      return;
    }

    const access = await this.access(
      { subject: subscription.owner, garminUserId: subscription.garmin_id },
      subscription.name,
    );

    if (access === "denied") {
      this.finish(job, "access_revoked");
      this.sql.exec("DELETE FROM event_subscriptions WHERE id=?", subscription.id);
      logEvent({
        event: "mcp_event_subscription_deleted",
        subscription: subscription.id,
        name: subscription.name,
        reason: "access_revoked",
      });

      return;
    }

    if (access === "unavailable") {
      this.retry(job, "authorization_unavailable");

      return;
    }

    const secret = await openSecret(subscription.secret, this.env.GARMIN_PUSH_TOKEN);

    if (!secret) {
      this.finish(job, "invalid_secret");
      this.sql.exec("DELETE FROM event_subscriptions WHERE id=?", subscription.id);
      logEvent({
        event: "mcp_event_subscription_deleted",
        subscription: subscription.id,
        name: subscription.name,
        reason: "invalid_secret",
      });

      return;
    }

    const previous =
      subscription.previous_secret && subscription.previous_until > Date.now()
        ? await openSecret(subscription.previous_secret, this.env.GARMIN_PUSH_TOKEN)
        : null;

    // Revocation, unsubscribe, deletion, or key refresh may have landed during authorization/decryption.
    const current = this.subscription(subscription.id);

    const event = this.sql
      .exec<BodyRow>("SELECT body FROM event_occurrences WHERE id=?", job.event_id)
      .toArray()[0];

    if (
      !current ||
      current.expires_at <= Date.now() ||
      job.deadline <= Date.now() ||
      this.blocked(current.name) ||
      !event
    ) {
      this.finish(
        job,
        job.deadline <= Date.now()
          ? "deadline_exceeded"
          : !event
            ? "payload_unavailable"
            : "subscription_unavailable",
      );

      return;
    }

    if (current.version !== subscription.version) {
      this.retry(job, "subscription_changed");

      return;
    }

    try {
      const response = await postWebhook(
        current.callback,
        job.event_id,
        current.id,
        previous ? [secret, previous] : [secret],
        event.body,
      );

      await response.body?.cancel();

      const outcome = response.ok ? "delivered" : response.status >= 500 ? "http_5xx" : "http_4xx";
      logEvent({
        event: "mcp_event_webhook",
        event_id: job.event_id,
        subscription: current.id,
        attempt: job.attempts + 1,
        status: response.status,
        outcome,
      });

      if (response.ok || (response.status < 500 && ![408, 425, 429].includes(response.status))) {
        this.finish({ ...job, attempts: job.attempts + 1 }, outcome);
      } else {
        this.retry(job, outcome);
      }
    } catch {
      logEvent({
        event: "mcp_event_webhook",
        event_id: job.event_id,
        subscription: current.id,
        attempt: job.attempts + 1,
        outcome: "transport_error",
      });
      this.retry(job, "transport_error");
    }
  }
}
