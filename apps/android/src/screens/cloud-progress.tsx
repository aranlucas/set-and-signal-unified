import catalog from "@set-and-signal/exercises/catalog";
import { useMemo, useState } from "react";
import { Action, Caption, Heading, Page, Panel } from "../components/ui";
import { useCloud } from "../data/cloud";
import { hostedProfileSchema } from "../domain/hosted";
import { ProgressScreen } from "./progress-screen";

export function CloudProgressScreen() {
  const cloud = useCloud();
  const [deviceCharts, setDeviceCharts] = useState(false);

  const summary = useMemo(() => {
    const profile = hostedProfileSchema.parse(cloud.profile);
    const best = new Map<string, number>();
    const names = new Map<string, string>();
    let sets = 0;
    let volume = 0;

    for (const entry of profile.workouts.flatMap((workout) => workout.entries)) {
      names.set(
        entry.id,
        entry.muscleSnapshot?.n ??
          profile.customEx.find((exercise) => exercise.id === entry.id)?.n ??
          catalog.find((exercise) => exercise.id === entry.id)?.n ??
          "Recorded exercise",
      );
      const recorded = entry.sets.filter((set) => set.done);
      sets += recorded.length;

      for (const set of recorded) {
        const reps = set.r ?? 0;
        const load = set.w ?? 0;
        volume += reps * load;

        if (reps > 0 && load > (best.get(entry.id) ?? 0)) {
          best.set(entry.id, load);
        }
      }
    }

    return {
      workouts: profile.workouts.length,
      sets,
      volume,
      unit: profile.unit,
      names,
      best: [...best].toSorted((a, b) => b[1] - a[1]).slice(0, 10),
    };
  }, [cloud.profile]);

  if (deviceCharts) {
    return (
      <>
        <Action onPress={() => setDeviceCharts(false)}>Return to account progress</Action>
        <ProgressScreen />
      </>
    );
  }

  return (
    <Page>
      <Panel>
        <Heading>Account progress</Heading>
        <Caption>Phone, web and imported watch workouts · saved account copy</Caption>
        <Caption>{`${summary.workouts} workouts · ${summary.sets} attempted sets`}</Caption>
        <Caption>{`${summary.volume.toFixed(1)} ${summary.unit} total recorded volume`}</Caption>
      </Panel>
      <Panel>
        <Heading>Best recorded working weights</Heading>
        {summary.best.length ? (
          summary.best.map(([id, weight]) => (
            <Caption
              key={id}
            >{`${summary.names.get(id) ?? "Recorded exercise"} · ${weight.toFixed(1)} ${summary.unit}`}</Caption>
          ))
        ) : (
          <Caption>Log completed sets to see your working weights here.</Caption>
        )}
        <Caption>
          Only attempted sets with recorded loads contribute. Full trends are available in web
          Progress.
        </Caption>
      </Panel>
      <Panel>
        <Action secondary onPress={() => setDeviceCharts(true)}>
          This phone's 5×5 charts
        </Action>
      </Panel>
    </Page>
  );
}
