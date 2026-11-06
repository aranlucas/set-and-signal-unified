import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "../../../convex/schema";
import { api } from "../../../convex/_generated/api";
import { canonical } from "@set-and-signal/training/state";
import { adaptSession, createSessionRoutine } from "@/domain/training/session-planner";
import { parseStoredState } from "@/shared/lib/schemas";

const modules = import.meta.glob("../../../convex/**/*.ts");

it("round-trips separate copies and logged snapshots through local Convex while retaining source history", async () => {
  const backend = convexTest(schema, modules).withIdentity({ subject: "synthetic", service: true });

  const source = {
    id: "original",
    name: "Template",
    emoji: "barbell",
    ex: [{ id: "0025", sets: 3, reps: 8, weight: 40 }],
  };

  const constraints = { equipment: [], budgetMin: 20, restSec: 60 };

  const copy = createSessionRoutine(
    source,
    constraints,
    adaptSession(source, constraints),
    "copy",
    "Travel copy",
  );

  const history = {
    id: "past",
    d: "2026-01-01",
    start: 1,
    end: 2,
    routineId: source.id,
    name: source.name,
    entries: [{ id: "0025", sets: [{ w: 40, r: 8, done: true }] }],
    prs: [],
    vol: 320,
  };

  await backend.mutation(api.training.replace, {
    state: JSON.stringify({ routines: [source], workouts: [history] }),
    expected: null,
  });
  await backend.mutation(api.training.commit, {
    changes: [
      { key: "routines/copy", expected: null, value: canonical(copy) },
      {
        key: "order/routines",
        expected: JSON.stringify([source.id]),
        value: JSON.stringify([source.id, copy.id]),
      },
    ],
  });

  const completed = {
    ...history,
    id: "adapted",
    routineId: copy.id,
    name: copy.name,
    sessionPlan: copy.sessionPlan,
  };

  await backend.mutation(api.training.commit, {
    changes: [
      { key: "workouts/adapted", expected: null, value: canonical(completed) },
      {
        key: "order/workouts",
        expected: JSON.stringify([history.id]),
        value: JSON.stringify([history.id, completed.id]),
      },
    ],
  });
  const snapshot = await backend.query(api.training.snapshot, {});
  const parsed = parseStoredState(JSON.stringify(snapshot));
  expect(parsed?.routines?.find((routine) => routine.id === source.id)).toEqual(source);
  expect(parsed?.workouts?.find((workout) => workout.id === history.id)).toEqual(history);
  expect(parsed?.routines?.find((routine) => routine.id === copy.id)?.sessionPlan).toEqual(
    copy.sessionPlan,
  );
  expect(parsed?.workouts?.find((workout) => workout.id === completed.id)?.sessionPlan).toEqual(
    copy.sessionPlan,
  );
});
