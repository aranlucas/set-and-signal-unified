import {
  reconcileGarminRecording,
  unlinkGarminRecording,
} from "@set-and-signal/training/reconcile";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import * as v from "valibot";
import { garminStrengthWorkout } from "@set-and-signal/training/garmin";
import {
  garminRecordedWorkout,
  assignRecordedRoutine,
  type GarminRecordingPreview,
} from "@set-and-signal/training/garmin-recording";
import { useStore } from "@/app/store/useStore";
import { api, apiParsed } from "@/shared/lib/api";
import { DEMO } from "@/shared/lib/demo";
import { todayISO } from "@/shared/lib/format";
import { exOr } from "@/domain/exercises/exercises";
import { modeOf } from "@/domain/training/history";
import {
  nextPrescription,
  applyPrescriptionToConfig,
  applyWorkoutProgression,
} from "@/domain/training/progression";
import { Section } from "@/shared/components/layout";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Input } from "@/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "@/shared/ui/native-select";

const statusSchema = v.object({ configured: v.boolean(), connected: v.boolean() });

const urlSchema = v.object({ url: v.string() });

const sectionSchema = v.object({
  availability: v.string(),
  hasMore: v.boolean(),
  nextOffset: v.nullable(v.number()),
  records: v.array(
    v.object({
      summaryId: v.string(),
      receivedAt: v.string(),
      activityId: v.optional(v.nullable(v.union([v.string(), v.number()]))),
    }),
  ),
});

const daySchema = v.object({ date: v.string(), sections: v.record(v.string(), sectionSchema) });

const publicationSchema = v.object({
  phase: v.string(),
  message: v.string(),
  workoutId: v.optional(v.number()),
  scheduleId: v.optional(v.number()),
});

const formSchema = v.object({
  date: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/u)),
  routineId: v.pipe(v.string(), v.minLength(1)),
});

type PlanForm = v.InferOutput<typeof formSchema>;

type Prepared = ReturnType<typeof garminStrengthWorkout>;

type PublishResult = v.InferOutput<typeof publicationSchema>;

export function GarminPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const user = useStore((store) => store.user);
  const state = useStore((store) => store.appState);
  const update = useStore((store) => store.update);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [preview, setPreview] = useState<GarminRecordingPreview | null>(null);
  const [match, setMatch] = useState("");
  const [recordedRoutine, setRecordedRoutine] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<PublishResult | null>(null);

  const form = useForm<PlanForm>({
    resolver: valibotResolver(formSchema),
    defaultValues: { date: todayISO(), routineId: state.routines[0]?.id ?? "" },
  });

  const date = useWatch({ control: form.control, name: "date" });

  const status = useQuery({
    queryKey: ["garmin", user?.id, "status"],
    queryFn: () => apiParsed("/api/garmin/status", statusSchema),
    enabled: !!user && !DEMO,
  });

  const connected = status.data?.connected === true;

  const day = useQuery({
    queryKey: ["garmin", user?.id, "day", date],
    queryFn: () => apiParsed(`/api/garmin/day?date=${encodeURIComponent(date)}`, daySchema),
    enabled: connected && /^\d{4}-\d{2}-\d{2}$/u.test(date),
  });

  const failure = (cause: unknown) =>
    setError(
      cause instanceof Error
        ? cause.message
        : t("garmin.requestFailed", "Garmin request failed. Your training data is saved."),
    );

  const connect = useMutation({
    mutationFn: () => apiParsed("/api/garmin/connect", urlSchema, { method: "POST", body: "{}" }),
    onSuccess: (value) => window.location.assign(value.url),
    onError: failure,
  });

  const disconnect = useMutation({
    mutationFn: () => api("/api/garmin/disconnect", { method: "POST", body: "{}" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["garmin", user?.id] });
      setPreview(null);
      setPrepared(null);
      void status.refetch().catch(failure);
    },
    onError: failure,
  });

  const publish = useMutation({
    mutationFn: () => {
      if (!prepared) {
        throw new Error("Preview the session first");
      }

      // Keep the same operation identity after a lost response or page reload.
      const key = "garmin-publication:" + user?.id + ":" + JSON.stringify([date, prepared.workout]);
      const id = localStorage.getItem(key) ?? crypto.randomUUID();
      localStorage.setItem(key, id);

      return apiParsed("/api/garmin/workout", publicationSchema, {
        method: "POST",
        body: JSON.stringify({ id, date, workout: prepared.workout }),
      });
    },
    onSuccess: (value) => {
      setResult(value);
      setPrepared(null);
    },
    onError: failure,
    retry: false,
  });

  const activity = useMutation({
    mutationFn: async (id: string) => {
      const value = await api(`/api/garmin/activity?activityId=${encodeURIComponent(id)}`);

      return garminRecordedWorkout(value, state.unit);
    },
    onSuccess: (value) => {
      setPreview(value);
      setMatch("");
      setRecordedRoutine("");
    },
    onError: failure,
  });

  const doPreview = form.handleSubmit((values) => {
    setError("");
    setResult(null);

    try {
      const routine = state.routines.find((candidate) => candidate.id === values.routineId);

      if (!routine) {
        throw new Error("Choose a routine");
      }

      const exercises = routine.ex.map((original) => {
        const cfg = applyPrescriptionToConfig(original, nextPrescription(state, original, routine));

        if (modeOf(cfg) !== "reps") {
          throw new Error(
            t(
              "garmin.strengthOnly",
              "This watch preview supports strength sets. Split timed or cardio exercises into a separate workout.",
            ),
          );
        }

        return {
          id: cfg.id,
          name: state.customEx.find((exercise) => exercise.id === cfg.id)?.n ?? exOr(cfg.id).n,
          sets: cfg.sets,
          reps: cfg.reps ?? 5,
          weight: cfg.weight ?? 0,
        };
      });

      setPrepared(
        garminStrengthWorkout({
          name: routine.name,
          unit: state.unit,
          restSeconds: state.restSec,
          exercises,
        }),
      );
    } catch (cause) {
      failure(cause);
    }
  });

  const acceptRecording = () => {
    if (!preview?.workout) {
      return;
    }

    const selected = state.routines.find((routine) => routine.id === recordedRoutine);

    const record =
      selected && !match ? assignRecordedRoutine(preview.workout, selected) : preview.workout;

    try {
      update((draft) => {
        const existed = draft.workouts.some(
          (workout) =>
            workout.id === record.id ||
            workout.garminActivityIds?.includes(record.source?.id ?? ""),
        );

        draft.workouts = reconcileGarminRecording(draft.workouts, record, match || undefined);

        if (!existed && !match && selected) {
          applyWorkoutProgression(draft, record);
        }

        for (const exercise of preview.customExercises) {
          if (!draft.customEx.some((candidate) => candidate.id === exercise.id)) {
            draft.customEx.push(exercise);
          }
        }
      });
    } catch (cause) {
      failure(cause);

      return;
    }

    setPreview(null);
  };

  const activities = [
    ...new Map(
      Object.values(day.data?.sections ?? {}).flatMap((section) =>
        section.records
          .filter((record) => record.activityId !== null && record.activityId !== undefined)
          .map((record) => [String(record.activityId), record] as const),
      ),
    ).entries(),
  ];

  return (
    <Section
      title={t("garmin.title", "Garmin · train on your watch")}
      footer={t(
        "garmin.footer",
        "Recorded results stay distinct from planned targets. A scheduled workout still needs to sync to your watch.",
      )}
    >
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          {t(
            "garmin.description",
            "Send a planned strength session to Garmin, or review a workout recorded on your watch. Phone and watch recordings can share one history entry.",
          )}
        </p>
        {!user || DEMO ? (
          <p>
            {t(
              "garmin.signInFirst",
              "Sign in to connect Garmin. Local phone training stays available.",
            )}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <strong>
                {connected
                  ? t("garmin.connected", "Garmin connected")
                  : t("garmin.notConnected", "Garmin not connected")}
              </strong>
              <Button
                onClick={() => connect.mutate()}
                disabled={connect.isPending || status.data?.configured === false}
              >
                {connected
                  ? t("garmin.reconnect", "Reconnect")
                  : t("garmin.connect", "Connect Garmin")}
              </Button>
              {connected && (
                <Button
                  variant="outline"
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                >
                  {t("garmin.disconnect", "Disconnect")}
                </Button>
              )}
            </div>
            {status.data?.configured === false && (
              <p role="status">
                {t("garmin.notConfigured", "The server has not configured Garmin yet.")}
              </p>
            )}
            {connected && (
              <>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    void doPreview(event).catch(failure);
                  }}
                >
                  <Label className="block">
                    <span>{t("garmin.date", "Training date")}</span>
                    <Input type="date" {...form.register("date")} />
                  </Label>
                  <Label className="block">
                    <span>{t("garmin.routine", "Routine")}</span>
                    <NativeSelect className="w-full" {...form.register("routineId")}>
                      {state.routines.map((routine) => (
                        <NativeSelectOption key={routine.id} value={routine.id}>
                          {routine.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Label>
                  <Button type="submit" disabled={!state.routines.length}>
                    {t("garmin.preview", "Preview watch workout")}
                  </Button>
                </form>
                {prepared && (
                  <div className="space-y-3 border-t border-border pt-3">
                    <h3 className="font-semibold">
                      {prepared.workout.workoutName} · {date}
                    </h3>
                    <ol className="list-inside list-decimal space-y-1">
                      {prepared.workout.segments[0].steps
                        .filter((step) => step.intensity === "ACTIVE")
                        .map((step) => (
                          <li key={step.stepOrder}>
                            {step.description} · {step.durationValue} {t("garmin.reps", "reps")}
                          </li>
                        ))}
                    </ol>
                    {prepared.unmapped.length > 0 && (
                      <p>
                        {t("garmin.unmapped", "These exercises will use descriptions: {{names}}", {
                          names: prepared.unmapped.join(", "),
                        })}
                      </p>
                    )}
                    <Button onClick={() => publish.mutate()} disabled={publish.isPending}>
                      {t("garmin.send", "Confirm & send to Garmin")}
                    </Button>
                    <Button variant="ghost" onClick={() => setPrepared(null)}>
                      {t("common.cancel", "Cancel")}
                    </Button>
                  </div>
                )}
                {result && (
                  <p role="status">
                    {result.message}
                    {result.workoutId ? ` (${result.workoutId})` : ""}
                  </p>
                )}
                <div className="border-t border-border pt-3">
                  <h3 className="font-semibold">{t("garmin.recordings", "Recorded workouts")}</h3>
                  {day.isPending ? (
                    <p>{t("garmin.loading", "Reading received Garmin data…")}</p>
                  ) : null}
                  {activities.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "garmin.noRecordings",
                        "No activity records have been received for this date. Sync Garmin Connect and refresh.",
                      )}
                    </p>
                  )}
                  {activities.map(([id]) => (
                    <Button
                      key={id}
                      variant="outline"
                      className="mt-2 mr-2"
                      disabled={activity.isPending}
                      onClick={() => activity.mutate(id)}
                    >
                      {t("garmin.reviewActivity", "Review activity {{id}}", { id })}
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void day.refetch().catch(failure);
                    }}
                  >
                    {t("garmin.refresh", "Refresh Garmin")}
                  </Button>
                </div>
                {preview && (
                  <div className="space-y-3 border-t border-border pt-3">
                    {preview.warnings.map((warning) => (
                      <p key={warning} role="status">
                        {warning}
                      </p>
                    ))}
                    {preview.workout && (
                      <>
                        <h3 className="font-semibold">{preview.workout.name}</h3>
                        {preview.workout.entries.map((entry) => (
                          <p key={entry.id}>
                            {entry.muscleSnapshot?.n} ·{" "}
                            {entry.sets
                              .map((set) => `${set.r} × ${set.w.toFixed(1)} ${state.unit}`)
                              .join(", ")}
                          </p>
                        ))}
                        <Label className="block">
                          <span>{t("garmin.match", "Match this to a phone log?")}</span>
                          <NativeSelect
                            className="w-full"
                            value={match}
                            onChange={(event) => setMatch(event.target.value)}
                          >
                            <NativeSelectOption value="">
                              {t("garmin.newRecording", "Import as a separate recorded workout")}
                            </NativeSelectOption>
                            {state.workouts
                              .filter(
                                (workout) =>
                                  workout.d === preview.workout?.d &&
                                  workout.source?.provider !== "garmin",
                              )
                              .map((workout) => (
                                <NativeSelectOption key={workout.id} value={workout.id}>
                                  {workout.name}
                                </NativeSelectOption>
                              ))}
                          </NativeSelect>
                        </Label>
                        {!match && (
                          <Label className="block">
                            <span>
                              {t("garmin.recordedRoutine", "Apply recorded results to a routine")}
                            </span>
                            <NativeSelect
                              value={recordedRoutine}
                              onChange={(event) => setRecordedRoutine(event.target.value)}
                            >
                              <NativeSelectOption value="">
                                {t("garmin.historyOnly", "History only · keep plan unchanged")}
                              </NativeSelectOption>
                              {state.routines.map((routine) => (
                                <NativeSelectOption key={routine.id} value={routine.id}>
                                  {routine.name}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          </Label>
                        )}
                        <Button onClick={acceptRecording}>
                          {match
                            ? t("garmin.linkRecording", "Link recording without adding a workout")
                            : t("garmin.importRecording", "Import recorded sets")}
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" onClick={() => setPreview(null)}>
                      {t("common.cancel", "Cancel")}
                    </Button>
                  </div>
                )}
                {state.workouts
                  .filter((workout) => workout.garminActivityIds?.length)
                  .map((workout) => (
                    <div key={workout.id} className="space-y-2">
                      <p>
                        {workout.name} · {workout.d}
                      </p>
                      {workout.garminActivityIds?.map((id) => (
                        <Button
                          key={id}
                          variant="ghost"
                          onClick={() => {
                            try {
                              update((draft) => {
                                draft.workouts = unlinkGarminRecording(
                                  draft.workouts,
                                  workout.id,
                                  id,
                                );
                              });
                            } catch (cause) {
                              failure(cause);
                            }
                          }}
                        >
                          {t("garmin.unlinkRecording", "Unlink activity {{id}}", { id })}
                        </Button>
                      ))}
                    </div>
                  ))}
                <div className="text-sm text-muted-foreground">
                  {t("garmin.healthAvailability", "Sleep: {{sleep}} · HRV: {{hrv}}", {
                    sleep: day.data?.sections.sleeps?.availability ?? "not received",
                    hrv: day.data?.sections.hrv?.availability ?? "not received",
                  })}
                </div>
              </>
            )}
          </>
        )}
        {(error || status.error || day.error) && (
          <p role="alert" className="text-destructive">
            {error || status.error?.message || day.error?.message}
          </p>
        )}
      </div>
    </Section>
  );
}
