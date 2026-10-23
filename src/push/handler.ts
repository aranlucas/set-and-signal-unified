import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  isActivityType,
  notification,
  publicSummary,
  pushPayload,
  summary,
  summaryDate,
  summaryType,
  userId,
} from "./schemas";
import { userStore, type StoredSummary } from "./store";

interface PermissionChange {
  userId: string;
  permissions: string[];
  time: number;
}

export function validPushCredential(value: string, expected: string) {
  const actual = Buffer.from(value);
  const secret = Buffer.from(expected);

  return secret.length >= 32 && actual.length === secret.length && timingSafeEqual(actual, secret);
}

export async function receivePush(
  request: Request,
  env: Env,
  credential: string,
): Promise<Response> {
  if (!validPushCredential(credential, env.GARMIN_PUSH_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return new Response(null, { status: 415 });
  }

  const body = pushPayload.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return new Response(null, { status: 400 });
  }

  const groups = new Map<string, StoredSummary[]>();
  const revoke = new Set<string>();
  const permissionChanges: PermissionChange[] = [];

  for (const [type, values] of Object.entries(body.data)) {
    for (const value of values ?? []) {
      if (type === "deregistrations" || type === "userPermissionsChange") {
        const parsed = notification.safeParse(value);

        if (!parsed.success) {
          return new Response(null, { status: 400 });
        }

        if (
          type === "userPermissionsChange" &&
          (!parsed.data.permissions || parsed.data.changeTimeInSeconds === undefined)
        ) {
          return new Response(null, { status: 400 });
        }

        if (type === "deregistrations") {
          revoke.add(parsed.data.userId);
        } else {
          permissionChanges.push({
            userId: parsed.data.userId,
            permissions: parsed.data.permissions ?? [],
            time: parsed.data.changeTimeInSeconds ?? 0,
          });
        }

        continue;
      }

      const parsed = summary.safeParse(value);

      if (!parsed.success) {
        return new Response(null, { status: 400 });
      }

      const item = parsed.data;
      const records = groups.get(item.userId) ?? [];

      const row: StoredSummary = {
        type: summaryType.parse(type),
        summaryId: item.summaryId,
        date: summaryDate(item),
        receivedAt: Date.now(),
        data: publicSummary(item),
      };

      if (!isActivityType(type) && item.startTimeInSeconds !== undefined) {
        row.startTime = item.startTimeInSeconds;
        row.duration = item.durationInSeconds ?? 0;
      }

      records.push(row);
      groups.set(item.userId, records);
    }
  }

  // Only durable acceptance before acknowledgement; no upstream calls or AI processing on delivery.
  await Promise.all(
    permissionChanges.map((change) =>
      userStore(env, change.userId).permissions(change.permissions, change.time),
    ),
  );
  await Promise.all(
    [...groups].map(async ([id, records]) => {
      const store = userStore(env, id);

      if (!revoke.has(id) && !(await store.isRevoked())) {
        await store.ingest(records);
      }
    }),
  );
  await Promise.all([...revoke].map((id) => userStore(env, id).revoke()));

  return new Response(null, { status: 200 });
}

export async function purgeUser(request: Request, env: Env) {
  if (
    !validPushCredential(
      request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "",
      env.GARMIN_PUSH_TOKEN,
    )
  ) {
    return new Response(null, { status: 401 });
  }

  const parsed = z
    .object({ userId, action: z.enum(["disconnect", "activate"]).default("disconnect") })
    .safeParse(await request.json());

  if (!parsed.success) {
    return new Response(null, { status: 400 });
  }

  const store = userStore(env, parsed.data.userId);

  if (parsed.data.action === "activate") {
    await store.activate();
  } else {
    await store.revoke();
  }

  return new Response(null, { status: 204 });
}
