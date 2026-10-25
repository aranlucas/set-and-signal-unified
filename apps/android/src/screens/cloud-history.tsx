import catalog from "@set-and-signal/exercises/catalog";
import { useMemo, useState, type ReactNode } from "react";
import { Action, Caption, Heading, Page, Panel } from "../components/ui";
import { notify } from "../data/notices";
import { useCloud, unlinkWatchRecording } from "../data/cloud";
import { hostedProfileSchema } from "../domain/hosted";

interface CloudHistoryProps {
  children: ReactNode;
}

export function CloudHistory({ children }: CloudHistoryProps) {
  const cloud = useCloud();
  const [archive, setArchive] = useState(false);
  const [limit, setLimit] = useState(20);
  const parsed = useMemo(() => hostedProfileSchema.safeParse(cloud.profile), [cloud.profile]);

  if (!cloud.user || archive) {
    return (
      <>
        {children}
        {cloud.user ? (
          <Action onPress={() => setArchive(false)}>Return to account history</Action>
        ) : null}
      </>
    );
  }

  const workouts = parsed.success ? parsed.data.workouts.toSorted((a, b) => b.end - a.end) : [];

  return (
    <Page>
      <Panel>
        <Heading>Your training history</Heading>
        <Caption>{`${workouts.length} workouts · phone, web and imported watch records`}</Caption>
        <Caption>
          {cloud.phase === "offline" ? "Offline · showing the saved account copy" : cloud.phase}
        </Caption>
        <Action subtle onPress={() => setArchive(true)}>
          Open this phone's device archive
        </Action>
      </Panel>
      {workouts.slice(0, limit).map((workout) => (
        <Panel key={workout.id}>
          <Heading>{workout.name}</Heading>
          <Caption>{`${workout.d} · ${workout.source?.provider ?? "Set & Signal"}${workout.garminActivityIds?.length ? " · Garmin linked" : ""}`}</Caption>
          {workout.garminActivityIds?.map((id) => (
            <Action
              key={id}
              subtle
              onPress={() => {
                try {
                  unlinkWatchRecording(workout.id, id);
                } catch (cause) {
                  notify(cause instanceof Error ? cause.message : "Could not unlink recording");
                }
              }}
            >{`Unlink Garmin activity ${id}`}</Action>
          ))}
          {workout.entries.map((entry) => (
            <Caption
              key={entry.id}
            >{`${entry.muscleSnapshot?.n ?? catalog.find((exercise) => exercise.id === entry.id)?.n ?? entry.id}: ${entry.sets
              .filter((set) => set.done)
              .map((set) =>
                set.r !== undefined
                  ? `${set.r} × ${set.w ?? 0} ${parsed.success ? parsed.data.unit : ""}`
                  : set.sec !== undefined
                    ? `${set.sec}s`
                    : `${set.min ?? 0}min`,
              )
              .join(", ")}`}</Caption>
          ))}
        </Panel>
      ))}
      {workouts.length > limit ? (
        <Action onPress={() => setLimit(limit + 20)}>Show more workouts</Action>
      ) : null}
    </Page>
  );
}
