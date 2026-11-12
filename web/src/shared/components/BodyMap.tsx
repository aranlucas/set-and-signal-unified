import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMuscleLabels } from "@/shared/hooks/use-muscle-labels";
import { MUSCLES, INERT, levelsOf } from "@/domain/exercises/muscles";
import type { MuscleSlug } from "@/domain/exercises/muscles";
import type { Body } from "@/shared/lib/types";
import type { BodyPaths } from "@/domain/exercises/body-paths";

type MuscleMapViewProps = {
  view: BodyViewPaths;
  muscleLevels: Record<string, number>;
  onMuscle?: (slug: MuscleSlug) => void;
  selectedMuscle?: MuscleSlug | null;
};

type BodyMapProps = {
  load?: Partial<Record<MuscleSlug, number>>;
  body?: Body;
  onMuscle?: (slug: MuscleSlug) => void;
  selected?: MuscleSlug | null;
  className?: string;
};

const muscleLevelClasses = [
  "fill-muted",
  "fill-primary/30",
  "fill-primary/50",
  "fill-primary/75",
  "fill-primary",
] as const;

const muscleLevelClass = (level: number) => muscleLevelClasses[level] ?? muscleLevelClasses[0];

const legendCellClass = (level: number) =>
  `${muscleLevelClasses[level]} size-2.5 shrink-0 rounded-none`;

// Front and back views of a body, each muscle shaded by how hard it was worked.
//
// The five shade steps are the same ones the activity heatmap uses (.hm-c.l0…l4), so
// "more accent = more training" means one thing everywhere in the app rather than two.
//
// The geometry is ~90 KB and only some screens show a map, so it is fetched on first
// render instead of riding along in the main bundle. Until it lands the component
// renders nothing but keeps its height, so nothing below it jumps on arrival.

let cachedBodyPaths: BodyPaths | null = null; // shared across every mounted map

let bodyPathsPromise: Promise<BodyPaths> | null = null;

const EMPTY_LOAD: Record<string, number> = {};

function useBodyPaths(): BodyPaths | null {
  const [bodyPaths, setBodyPaths] = useState(cachedBodyPaths);
  useEffect((): (() => void) | undefined => {
    if (cachedBodyPaths) {
      return undefined;
    }

    let isMounted = true;
    bodyPathsPromise =
      bodyPathsPromise ||
      import("@/domain/exercises/body-paths").then((module) => (cachedBodyPaths = module.default));
    bodyPathsPromise
      .then((loadedPaths): undefined => {
        if (isMounted) {
          setBodyPaths(loadedPaths);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  return bodyPaths;
}

type BodyViewPaths = BodyPaths["male"]["front"];

function MuscleMapView({ view, muscleLevels, onMuscle, selectedMuscle }: MuscleMapViewProps) {
  const { t } = useTranslation();
  const muscleLabels = useMuscleLabels();
  const activateMuscle = (slug: MuscleSlug) => onMuscle?.(slug);

  const handleMuscleKeyDown = (event: KeyboardEvent<SVGPathElement>, slug: MuscleSlug) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    activateMuscle(slug);
  };

  return (
    <svg
      className="h-auto max-h-80 min-w-0 flex-1"
      viewBox={view.vb}
      role={onMuscle ? "group" : "img"}
      aria-label={t("muscleMap.label", "Muscle map")}
    >
      {INERT.map((slug) =>
        (view.p[slug] || []).map((pathData) => (
          <path
            key={slug + pathData}
            className="fill-muted stroke-card stroke-2"
            d={pathData}
            strokeLinejoin="round"
          />
        )),
      )}
      {MUSCLES.map((slug) =>
        (view.p[slug] || []).map((pathData) => (
          <path
            key={slug + pathData}
            className={`${muscleLevelClass(muscleLevels[slug] || 0)} stroke-card stroke-2 transition-colors duration-200 ease-out ${selectedMuscle === slug ? "stroke-foreground" : ""}${onMuscle ? " cursor-pointer" : ""}`}
            d={pathData}
            strokeLinejoin="round"
            role={onMuscle ? "button" : undefined}
            tabIndex={onMuscle ? 0 : undefined}
            aria-label={onMuscle ? muscleLabels[slug] : undefined}
            onClick={onMuscle ? () => activateMuscle(slug) : undefined}
            onKeyDown={onMuscle ? (event) => handleMuscleKeyDown(event, slug) : undefined}
          >
            <title>{muscleLabels[slug]}</title>
          </path>
        )),
      )}
    </svg>
  );
}

/**
 * <BodyMap load={{ chest: 12, … }} body="male" />
 * `load` is effective sets per muscle (see lib/muscles.js); shading is relative to
 * the hardest-worked muscle in that same load, so it always reads as a balance.
 */
export default function BodyMap({
  load = EMPTY_LOAD,
  body = "male",
  onMuscle,
  selected,
  className = "",
}: BodyMapProps) {
  const paths = useBodyPaths();
  const muscleLevels = levelsOf(load);
  const bodyPaths = paths && (paths[body] || paths.male);

  return (
    <div className={`flex items-start justify-center gap-1.5 ${className}`}>
      {bodyPaths ? (
        <>
          <MuscleMapView
            view={bodyPaths.front}
            muscleLevels={muscleLevels}
            onMuscle={onMuscle}
            selectedMuscle={selected}
          />
          <MuscleMapView
            view={bodyPaths.back}
            muscleLevels={muscleLevels}
            onMuscle={onMuscle}
            selectedMuscle={selected}
          />
        </>
      ) : (
        <div className="h-50" aria-hidden="true" />
      )}
    </div>
  );
}

export function BodyMapLegend() {
  const { t } = useTranslation();

  return (
    <div className="mt-2.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
      {t("muscleMap.less", "Less")}{" "}
      {[0, 1, 2, 3, 4].map((level) => (
        <div key={level} className={legendCellClass(level)} />
      ))}{" "}
      {t("muscleMap.more", "More")}
    </div>
  );
}
