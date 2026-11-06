import * as validation from "valibot";
import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { canonical, joinState, splitState } from "@set-and-signal/training/state";
import { safeParse } from "valibot";
import { appStatePatch } from "../src/shared/lib/schemas";
import type { MutationCtx, QueryCtx } from "./_generated/server";

async function owner(ctx: QueryCtx | MutationCtx, service = false) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity || (service && identity.service !== true)) throw new ConvexError("Unauthorized");

  return identity.subject;
}

async function load(ctx: QueryCtx | MutationCtx, uid: string) {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_owner", (q) => q.eq("owner", uid))
    .unique();

  const records = await ctx.db
    .query("records")
    .withIndex("by_owner_key", (q) => q.eq("owner", uid))
    .collect();

  return { profile, records };
}

export const snapshot = query({
  args: {},
  handler: async (ctx) => {
    const { profile, records } = await load(ctx, await owner(ctx));

    return profile ? joinState(records, profile.revision) : null;
  },
});

const change = v.object({
  key: v.string(),
  expected: v.union(v.string(), v.null()),
  value: v.union(v.string(), v.null()),
});

export const commit = mutation({
  args: { changes: v.array(change), operationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const uid = await owner(ctx);

    if (args.operationId) {
      if (args.operationId.length > 200) throw new ConvexError("Invalid operation identity");

      const applied = await ctx.db
        .query("operations")
        .withIndex("by_owner_id", (q) => q.eq("owner", uid).eq("id", args.operationId!))
        .unique();

      if (applied) return null;
    }

    if (args.changes.length > 2000) throw new ConvexError("Too many changes");
    const seen = new Set<string>();
    const pending = [];

    for (const change of args.changes) {
      if (
        seen.has(change.key) ||
        !/^(field|order|workouts|routines|customEx)\/.+/.test(change.key) ||
        change.key === "field/active" ||
        change.key === "field/_ts"
      )
        throw new ConvexError("Invalid change");
      seen.add(change.key);

      const row = await ctx.db
        .query("records")
        .withIndex("by_owner_key", (q) => q.eq("owner", uid).eq("key", change.key))
        .unique();

      const current = row?.value ?? null;

      // A retried write whose response was lost is already successful.
      if (current === change.value) continue;

      if (current !== change.expected) throw new ConvexError({ code: "CONFLICT", key: change.key });

      if (change.value !== null) {
        const value = JSON.parse(change.value);

        if (canonical(value) !== change.value) throw new ConvexError("Invalid record encoding");
        const slash = change.key.indexOf("/");
        const kind = change.key.slice(0, slash);
        const id = change.key.slice(slash + 1);

        if (kind === "order") {
          if (
            !["workouts", "routines", "customEx"].includes(id) ||
            !Array.isArray(value) ||
            value.some((item) => !validation.is(validation.string(), item)) ||
            new Set(value).size !== value.length
          )
            throw new ConvexError("Invalid order");
        } else {
          if (kind === "field" && ["workouts", "routines", "customEx"].includes(id))
            throw new ConvexError("Use record changes");
          const patch = kind === "field" ? { [id]: value } : { [kind]: [value] };

          if (!safeParse(appStatePatch, patch).success || (kind !== "field" && value?.id !== id))
            throw new ConvexError("Invalid training record");
        }
      }

      pending.push({ change, row });
    }

    for (const { change, row } of pending) {
      if (change.value === null) {
        if (row) await ctx.db.delete(row._id);
      } else if (row) await ctx.db.patch(row._id, { value: change.value });
      else await ctx.db.insert("records", { owner: uid, key: change.key, value: change.value });
    }

    if (args.operationId) await ctx.db.insert("operations", { owner: uid, id: args.operationId });

    if (pending.length) {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_owner", (q) => q.eq("owner", uid))
        .unique();

      const revision = Math.max(Date.now(), (profile?.revision ?? 0) + 1);

      if (profile) await ctx.db.patch(profile._id, { revision });
      else await ctx.db.insert("profiles", { owner: uid, revision });
    }
  },
});

// Go's existing typed mutations use a compare-and-swap at this boundary.
// Only a server-issued service identity can replace a snapshot.
export const replace = mutation({
  args: {
    state: v.string(),
    expected: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const uid = await owner(ctx, true);
    const { profile, records } = await load(ctx, uid);

    if (args.expected !== null && (profile?.revision ?? 0) !== args.expected) return false;
    const value = JSON.parse(args.state);

    if (!value || Array.isArray(value) || !validation.is(validation.object({}), value))
      throw new ConvexError("State must be an object");
    const next = new Map(splitState(value).map((row) => [row.key, row.value]));

    for (const row of records) {
      const value = next.get(row.key);

      if (value === undefined) await ctx.db.delete(row._id);
      else if (row.value !== value) await ctx.db.patch(row._id, { value });
      next.delete(row.key);
    }

    for (const [key, value] of next) await ctx.db.insert("records", { owner: uid, key, value });
    const revision = Math.max(Date.now(), (profile?.revision ?? 0) + 1);

    if (profile) await ctx.db.patch(profile._id, { revision });
    else await ctx.db.insert("profiles", { owner: uid, revision });

    return true;
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const uid = await owner(ctx);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_owner", (q) => q.eq("owner", uid))
      .unique();

    const order = await ctx.db
      .query("records")
      .withIndex("by_owner_key", (q) => q.eq("owner", uid).eq("key", "order/workouts"))
      .unique();

    const ids: string[] = order ? JSON.parse(order.value) : [];
    const lastId = ids.at(-1);

    const last = lastId
      ? await ctx.db
          .query("records")
          .withIndex("by_owner_key", (q) => q.eq("owner", uid).eq("key", `workouts/${lastId}`))
          .unique()
      : null;

    return {
      workouts: ids.length,
      lastWorkout: last ? (JSON.parse(last.value).d ?? null) : null,
      lastSync: profile?.revision ?? null,
    };
  },
});
