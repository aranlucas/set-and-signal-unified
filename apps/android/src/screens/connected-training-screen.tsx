import catalog from "@set-and-signal/exercises/catalog";
import { useEffect, useMemo, useState } from "react";
import { Column, Row, Text } from "@expo/ui/jetpack-compose";
import { weight, fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { randomUUID } from "expo-crypto";
import { z } from "zod";
import { garminStrengthWorkout, type StrengthPlan } from "@set-and-signal/training/garmin";
import {
  garminRecordedWorkout,
  type GarminRecordingPreview,
} from "@set-and-signal/training/garmin-recording";
import { localDate, convertLoad } from "@set-and-signal/training/records";
import { Action, Caption, Field, Heading, Page, Panel } from "../components/ui";
import { CloudAccountPanel } from "./cloud-account-panel";
import { hostedProfileSchema, type HostedDraft, type HostedRoutine } from "../domain/hosted";
import {
  acceptGarminRecording,
  cloudApi,
  readHostedDraft,
  saveRecordedWorkout,
  useCloud,
  writeHostedDraft,
  watchPublicationId,
} from "../data/cloud";
import { notify } from "../data/notices";
import { useAppState } from "../data/store";

const daySchema = z.object({
  sections: z.record(
    z.string(),
    z.object({
      availability: z.string(),
      hasMore: z.boolean(),
      records: z.array(
        z.object({ activityId: z.union([z.string(), z.number()]).nullable().optional() }),
      ),
    }),
  ),
});

interface SetPatch {
  r?: number;
  w?: number;
  done?: boolean;
}

export function ConnectedTrainingScreen() {
  const cloud = useCloud();
  const nativeActive = useAppState((state) => state.active !== null);
  const profile = useMemo(() => hostedProfileSchema.safeParse(cloud.profile), [cloud.profile]);
  const data = profile.success ? profile.data : hostedProfileSchema.parse({});
  const [draft, setDraft] = useState<HostedDraft | null>(() => readHostedDraft());
  const [date, setDate] = useState(() => localDate(Date.now()));
  const [prepared, setPrepared] = useState<ReturnType<typeof garminStrengthWorkout> | null>(null);
  const [activities, setActivities] = useState<string[]>([]);
  const [recording, setRecording] = useState<GarminRecordingPreview | null>(null);
  const [match, setMatch] = useState("");
  const [recordedRoutine, setRecordedRoutine] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const endsAt = draft?.restEndsAt;
  useEffect(() => {
    if (!endsAt) {
      return;
    }

    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);

      if (now >= endsAt) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [endsAt]);

  const run = (action: () => Promise<void>) => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError("");
    void action()
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not complete that action"),
      )
      .finally(() => setBusy(false));
  };

  const plan = (routine: HostedRoutine): StrengthPlan => ({
    name: routine.name,
    unit: data.unit,
    restSeconds: data.restSec,
    exercises: routine.ex.map((cfg) => {
      if (cfg.mode && cfg.mode !== "reps") {
        throw new Error(
          "Use the web workout log for timed or cardio sessions. This native recorder handles strength sets.",
        );
      }

      return {
        id: cfg.id,
        name:
          data.customEx.find((exercise) => exercise.id === cfg.id)?.n ??
          catalog.find((exercise) => exercise.id === cfg.id)?.n ??
          cfg.id,
        sets: cfg.sets,
        reps: cfg.reps ?? 5,
        weight: cfg.weight ?? 0,
      };
    }),
  });

  const saveDraft = (next: HostedDraft | null) => {
    try {
      writeHostedDraft(next);
      setDraft(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save on this device");
    }
  };

  const begin = (routine: HostedRoutine, now: number) => {
    setError("");

    if (nativeActive) {
      setError("Finish or discard the active 5×5 workout first");

      return;
    }

    try {
      const prescription = plan(routine);
      const id = randomUUID();
      saveDraft({
        unit: data.unit,
        restEndsAt: 0,
        workout: {
          id,
          d: localDate(now),
          start: now,
          end: now,
          routineId: routine.id,
          name: routine.name,
          prs: [],
          vol: 0,
          source: { provider: "set-and-signal", id, recordedUnit: data.unit },
          entries: prescription.exercises.map((exercise) => ({
            id: exercise.id,
            target: {
              id: exercise.id,
              sets: exercise.sets,
              reps: exercise.reps,
              weight: exercise.weight,
            },
            muscleSnapshot: { n: exercise.name },
            sets: Array.from({ length: exercise.sets }, () => ({
              done: false,
              r: exercise.reps,
              w: exercise.weight,
              recordedWeight: exercise.weight,
            })),
          })),
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start session");
    }
  };

  const updateSet = (entryIndex: number, setIndex: number, patch: SetPatch, now: number) => {
    if (!draft) {
      return;
    }

    const next = structuredClone(draft);
    const set = next.workout.entries[entryIndex].sets[setIndex];
    Object.assign(set, patch);

    if (patch.w !== undefined) {
      set.recordedWeight = patch.w;
    }

    if (patch.done) {
      next.restEndsAt = now + data.restSec * 1000;
    }

    saveDraft(next);
  };

  const finish = () =>
    run(async () => {
      if (!draft) {
        return;
      }

      if (!draft.workout.entries.some((entry) => entry.sets.some((set) => set.done))) {
        throw new Error("Record at least one attempted set");
      }

      const workout = structuredClone(draft.workout);
      workout.end = Math.max(workout.start, Date.now());

      for (const entry of workout.entries) {
        for (const set of entry.sets) {
          set.w = convertLoad(set.w, draft.unit, data.unit);
        }

        if (entry.target) {
          entry.target.weight = convertLoad(entry.target.weight, draft.unit, data.unit);
        }
      }

      workout.vol = workout.entries.reduce(
        (total, entry) =>
          total + entry.sets.reduce((sum, set) => sum + (set.done ? set.w * set.r : 0), 0),
        0,
      );
      // The local record/outbox commit happens before any network request. A network
      // failure keeps the queued record so it can be retried with the same identity.
      await saveRecordedWorkout(workout);
      saveDraft(null);
      notify("Workout saved to your training history");
    });

  const readDay = () =>
    run(async () => {
      const day = daySchema.parse(
        await cloudApi(`/api/garmin/day?date=${encodeURIComponent(date)}`),
      );

      setActivities([
        ...new Set(
          Object.values(day.sections).flatMap((section) =>
            section.records.flatMap((record) =>
              record.activityId === undefined || record.activityId === null
                ? []
                : [String(record.activityId)],
            ),
          ),
        ),
      ]);
      setMessage(
        `Sleep: ${day.sections.sleeps?.availability ?? "not_received"}. HRV: ${day.sections.hrv?.availability ?? "not_received"}.${Object.values(day.sections).some((section) => section.hasMore) ? " More records are available in Garmin Connect." : ""}`,
      );
    });

  if (!cloud.user) {
    return (
      <Page>
        <Panel>
          <CloudAccountPanel />
        </Panel>
      </Page>
    );
  }

  return (
    <Page>
      {draft ? (
        <>
          <Panel>
            <Heading>{draft.workout.name}</Heading>
            <Caption>Saved on this device · {draft.unit}</Caption>
            {draft.restEndsAt > clock ? (
              <Caption>{`Rest ${Math.ceil((draft.restEndsAt - clock) / 1000)} seconds`}</Caption>
            ) : null}
            <Action disabled={busy} onPress={finish}>
              Finish & save workout
            </Action>
            <Action subtle onPress={() => saveDraft(null)}>
              Discard this session
            </Action>
          </Panel>
          {draft.workout.entries.map((entry, ei) => (
            <Panel key={entry.id}>
              <Heading>{entry.muscleSnapshot?.n ?? entry.id}</Heading>
              {entry.sets.map((set, si) => (
                <Column key={si} verticalArrangement={{ spacedBy: 8 }}>
                  <Text>{`Set ${si + 1}${set.done ? " · recorded" : " · not recorded"}`}</Text>
                  <Row modifiers={[fillMaxWidth()]} horizontalArrangement={{ spacedBy: 8 }}>
                    <Column modifiers={[weight(1)]}>
                      <Field
                        numeric
                        label={`Set ${si + 1} weight`}
                        value={String(set.w)}
                        onChange={(value) => {
                          const amount = Number(value);

                          if (Number.isFinite(amount) && amount >= 0) {
                            updateSet(ei, si, { w: amount }, Date.now());
                          }
                        }}
                      />
                    </Column>
                    <Column modifiers={[weight(1)]}>
                      <Field
                        numeric
                        label={`Set ${si + 1} reps`}
                        value={String(set.r)}
                        onChange={(value) => {
                          const reps = Number(value);

                          if (Number.isInteger(reps) && reps >= 0 && reps <= 10000) {
                            updateSet(ei, si, { r: reps }, Date.now());
                          }
                        }}
                      />
                    </Column>
                  </Row>
                  <Action
                    secondary={set.done}
                    onPress={() => updateSet(ei, si, { done: !set.done }, Date.now())}
                  >
                    {set.done ? `Clear set ${si + 1}` : `Record set ${si + 1}`}
                  </Action>
                </Column>
              ))}
            </Panel>
          ))}
        </>
      ) : (
        <>
          <Panel>
            <Heading>Plan once. Choose where to train.</Heading>
            <Caption>
              Routines from your web planner. Phone sessions work from this saved copy when offline.
            </Caption>
          </Panel>
          {!data.routines.length ? (
            <Panel>
              <Caption>
                No routines have synced yet. Build a plan on web, or import your phone's 5×5 plan in
                Account & Garmin.
              </Caption>
            </Panel>
          ) : null}
          {data.routines.map((routine) => (
            <Panel key={routine.id}>
              <Heading>{routine.name}</Heading>
              <Caption>{`${routine.ex.length} exercises · ${data.unit}`}</Caption>
              <Action onPress={() => begin(routine, Date.now())}>Train on phone</Action>
              <Action
                secondary
                disabled={busy}
                onPress={() => {
                  try {
                    setPrepared(garminStrengthWorkout(plan(routine)));
                    setError("");
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Could not prepare workout");
                  }
                }}
              >
                Preview on watch
              </Action>
            </Panel>
          ))}
        </>
      )}
      {prepared ? (
        <Panel>
          <Heading>Send to Garmin</Heading>
          <Field label="Calendar date (YYYY-MM-DD)" value={date} onChange={setDate} />
          <Caption>{prepared.workout.workoutName}</Caption>
          {prepared.workout.segments[0].steps
            .filter((step) => step.intensity === "ACTIVE")
            .map((step) => (
              <Caption
                key={step.stepOrder}
              >{`${step.description ?? "Exercise"} · ${step.durationValue} reps`}</Caption>
            ))}
          {prepared.unmapped.length ? (
            <Caption>{`Description-only exercises: ${prepared.unmapped.join(", ")}`}</Caption>
          ) : null}
          <Action
            disabled={busy}
            onPress={() =>
              run(async () => {
                const result = z.object({ message: z.string(), phase: z.string() }).parse(
                  await cloudApi("/api/garmin/workout", {
                    method: "POST",
                    body: JSON.stringify({
                      id: watchPublicationId({ date, workout: prepared.workout }),
                      date,
                      workout: prepared.workout,
                    }),
                  }),
                );

                setMessage(result.message);
                setPrepared(null);
              })
            }
          >
            Confirm & send to Garmin
          </Action>
          <Action subtle onPress={() => setPrepared(null)}>
            Cancel
          </Action>
        </Panel>
      ) : null}
      <Panel>
        <Heading>Recorded on your watch</Heading>
        <Field label="Date (YYYY-MM-DD)" value={date} onChange={setDate} />
        <Action secondary disabled={busy} onPress={readDay}>
          Refresh Garmin recordings
        </Action>
        {activities.map((id) => (
          <Action
            key={id}
            secondary
            disabled={busy}
            onPress={() =>
              run(async () => {
                const value = await cloudApi(
                  `/api/garmin/activity?activityId=${encodeURIComponent(id)}`,
                );

                setRecording(garminRecordedWorkout(value, data.unit));
                setMatch("");
                setRecordedRoutine("");
              })
            }
          >{`Review activity ${id}`}</Action>
        ))}
        {message ? <Caption>{message}</Caption> : null}
      </Panel>
      {recording ? (
        <Panel>
          <Heading>Review recorded results</Heading>
          {recording.warnings.map((warning) => (
            <Caption key={warning}>{warning}</Caption>
          ))}
          {recording.workout ? (
            <>
              <Caption>{recording.workout.name}</Caption>
              {recording.workout.entries.map((entry) => (
                <Caption
                  key={entry.id}
                >{`${entry.muscleSnapshot?.n ?? entry.id}: ${entry.sets.map((set) => `${set.r} × ${set.w.toFixed(1)} ${data.unit}`).join(", ")}`}</Caption>
              ))}
              <Action secondary onPress={() => setMatch("")}>
                {match ? "Import as a separate workout" : "Separate recorded workout selected"}
              </Action>
              {data.workouts
                .filter(
                  (workout) =>
                    workout.d === recording.workout?.d && workout.source?.provider !== "garmin",
                )
                .map((workout) => (
                  <Action
                    key={workout.id}
                    secondary={match !== workout.id}
                    onPress={() => setMatch(workout.id)}
                  >{`Match: ${workout.name}`}</Action>
                ))}
              {!match ? (
                <>
                  <Caption>Apply recorded results to a routine</Caption>
                  <Action secondary={!recordedRoutine} onPress={() => setRecordedRoutine("")}>
                    History only · keep plan unchanged
                  </Action>
                  {data.routines.map((routine) => (
                    <Action
                      key={routine.id}
                      secondary={recordedRoutine !== routine.id}
                      onPress={() => setRecordedRoutine(routine.id)}
                    >
                      {routine.name}
                    </Action>
                  ))}
                </>
              ) : null}
              <Action
                disabled={busy}
                onPress={() =>
                  run(async () => {
                    await acceptGarminRecording(
                      recording,
                      match || undefined,
                      recordedRoutine || undefined,
                    );
                    setRecording(null);
                    notify(
                      match
                        ? "Watch recording linked; workout counted once"
                        : "Recorded sets imported",
                    );
                  })
                }
              >
                {match ? "Link to phone log" : "Import recorded sets"}
              </Action>
            </>
          ) : null}
          <Action subtle onPress={() => setRecording(null)}>
            Close review
          </Action>
        </Panel>
      ) : null}
      {error || cloud.error ? (
        <Panel>
          <Caption>{error || cloud.error}</Caption>
        </Panel>
      ) : null}
    </Page>
  );
}
