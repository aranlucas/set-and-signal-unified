import { useTranslation } from "react-i18next";
import type { PolicyId } from "@/shared/lib/types";

type PolicyLabels = Record<PolicyId, { name: string; description: string }>;

export function useProgressionLabels(): PolicyLabels {
  const { t } = useTranslation();

  return {
    off: {
      name: t("progression.noAutomaticProgression", "No automatic progression"),
      description: t("progression.targetsStayWhereSetThem", "Targets stay where you set them."),
    },
    fivefold: {
      name: t("progression.fivefoldName", "Fivefold 5×5"),
      description: t(
        "progression.fivefoldDescription",
        "Progress after every rep succeeds. Deload after three fully attempted misses; skipped sets preserve the miss count.",
      ),
    },
    linear: {
      name: t("progression.linearProgression", "Linear progression"),
      description: t(
        "progression.hitEveryRepEverySet",
        "Hit every rep in every set and the weight goes up. Repeated misses trigger a deload.",
      ),
    },
    greyskull: {
      name: t("progression.greyskullLp", "Greyskull LP"),
      description: t(
        "progression.twoStraightSetsPlusFinal",
        "Two straight sets plus a final set taken to failure. Beat the target on that set and the weight goes up — double if you double the reps. One failure resets 10 %.",
      ),
    },
    double: {
      name: t("progression.doubleProgression", "Double progression"),
      description: t(
        "progression.workUpThroughRepRange",
        "Work up through a rep range at the same weight. Reach the top of the range in every set and the weight goes up, reps back to the bottom.",
      ),
    },
    time: {
      name: t("progression.addTime", "Add time"),
      description: t(
        "progression.holdEverySetFullDuration",
        "Hold every set for the full duration and the target goes up.",
      ),
    },
  };
}
