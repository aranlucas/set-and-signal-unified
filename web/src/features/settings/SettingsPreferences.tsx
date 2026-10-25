import { useTranslation } from "react-i18next";
import { useStore } from "@/app/store/useStore";
import { fmtPlate } from "@/shared/lib/format";
import { ACCENT_NAMES, DEFAULT_ACCENT } from "@/shared/lib/accents";
import { changeProfileUnit } from "@/domain/training/units";
import { effortOf } from "@/domain/training/history";
import {
  barWeightFor,
  COMMON_PLATES,
  defaultPlateSetup,
  effectivePlateSetup,
} from "@/domain/training/plates";
import { wakeLockSupported } from "@/shared/lib/wakelock";
import { LANGUAGES } from "@/i18n/languages";
import { DEMO } from "@/shared/lib/demo";
import { MOBILE } from "@/shared/lib/mobile";
import { NotificationsCard } from "@/features/settings/NotificationsCard";
import Icon from "@/shared/components/Icon";
import { Row, Section } from "@/shared/components/layout";
import { SelectRow } from "@/shared/components/SelectRow";
import { Switch } from "@/shared/ui/switch";
import { Segmented } from "@/shared/ui/segmented";
import { Stepper } from "@/shared/components/Stepper";
import { Button } from "@/shared/ui/button";
import type { Unit, Theme, Body, EffortScale } from "@/shared/lib/types";
import { toast } from "@/shared/lib/toast";

type SettingsPreferencesProps = { onEffortHelp: () => void };

export function SettingsPreferences({ onEffortHelp }: SettingsPreferencesProps) {
  const { t } = useTranslation();
  const appState = useStore((state) => state.appState);
  const update = useStore((state) => state.update);
  const user = useStore((state) => state.user);
  const wakeOK = wakeLockSupported();

  return (
    <>
      <Section
        title={t("settings.general", "General")}
        footer={t(
          "settings.unitsConverted",
          "Changing units converts recorded loads, body weight and plan targets. Original workout loads are preserved.",
        )}
      >
        <SelectRow
          icon="globe"
          iconTint="var(--system-blue)"
          title={t("settings.language", "Language")}
          value={appState.lang || "en"}
          onChange={(value) => update((state) => void (state.lang = value))}
          options={Object.entries(LANGUAGES).map(([key, language]) => ({
            value: key,
            label: language.label,
            subtitle: language.hasExercises
              ? undefined
              : t(
                  "settings.exerciseInstructionsArenTAvailable",
                  "Exercise instructions aren't available in this language yet — they stay in English.",
                ),
          }))}
        />
        <Row
          icon="scale"
          iconTint="var(--system-teal)"
          title={t("settings.weightUnit", "Weight unit")}
        >
          <Segmented<Unit>
            size="sm"
            className="min-w-33 flex-none"
            options={[
              { value: "lb", label: "lb" },
              { value: "kg", label: "kg" },
            ]}
            value={appState.unit}
            onChange={(value) =>
              update((state) => {
                changeProfileUnit(state, value);
              })
            }
          />
        </Row>
      </Section>
      <Section
        title={t("settings.duringWorkout", "During a workout")}
        footer={
          wakeOK
            ? t(
                "settings.screenStaysWhileWorkoutRunning",
                "The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.",
              )
            : null
        }
      >
        <SelectRow
          icon="timer"
          iconTint="var(--system-orange)"
          title={t("settings.restTimer", "Rest timer")}
          value={String(appState.restSec)}
          onChange={(value) => update((state) => void (state.restSec = Number(value)))}
          options={[60, 90, 120, 150, 180].map((value) => ({
            value: String(value),
            label: value + "s",
          }))}
        />
        {(wakeOK || !MOBILE) && (
          <Row
            icon="sun"
            iconTint="var(--warning)"
            title={t("settings.keepScreenAwake", "Keep screen awake")}
            subtitle={
              wakeOK ? null : t("settings.notSupportedBrowser", "Not supported in this browser.")
            }
          >
            <Switch
              aria-label={t("settings.keepScreenAwake", "Keep screen awake")}
              checked={wakeOK && appState.keepAwake !== false}
              disabled={!wakeOK}
              onCheckedChange={(keepAwake) => update((state) => void (state.keepAwake = keepAwake))}
            />
          </Row>
        )}
        <Row icon="bell" iconTint="var(--system-pink)" title={t("settings.sounds", "Sounds")}>
          <Switch
            aria-label={t("settings.sounds", "Sounds")}
            checked={appState.sound}
            onCheckedChange={(soundEnabled) => update((state) => void (state.sound = soundEnabled))}
          />
        </Row>
        <Row
          icon="target"
          iconTint="var(--system-purple)"
          title={t("effort.effortPerSet", "Effort per set")}
        >
          <Button
            variant="stepper"
            className="-my-3 flex h-11 w-6 flex-none items-center justify-center"
            aria-label={t("effort.whatRirRpe", "What are RIR and RPE?")}
            onClick={onEffortHelp}
          >
            <Icon name="info" className="text-muted-foreground" />
          </Button>
          <Segmented<EffortScale>
            size="sm"
            className="min-w-33 flex-none"
            options={[
              { value: "none", label: t("common.off", "Off") },
              { value: "rir", label: t("effort.rir", "RIR") },
              { value: "rpe", label: t("effort.rpe", "RPE") },
            ]}
            value={effortOf(appState)}
            onChange={(effortScale) =>
              update((state) => {
                state.effort = effortScale;
              })
            }
          />
        </Row>
      </Section>
      <Section
        title={t("settings.barbell.title", "Barbell")}
        footer={t(
          "settings.barbell.description",
          "Barbell exercises include the bar in their total and show which plates to load per side — or the closest weight your rack can build.",
        )}
      >
        <Row
          icon="barbell"
          iconTint="var(--primary)"
          title={t("settings.barbell.plateCalculator", "Plate calculator")}
        >
          <Switch
            aria-label={t("settings.barbell.plateCalculator", "Plate calculator")}
            checked={appState.plates?.on ?? true}
            onCheckedChange={(on) =>
              update((state) => {
                if (!state.plates) {
                  state.plates = defaultPlateSetup(state.unit);
                }

                state.plates.on = on;
              })
            }
          />
        </Row>
        {(appState.plates?.on ?? true) && (
          <>
            <Row
              icon="weight"
              iconTint="var(--system-orange)"
              className="flex-wrap sm:flex-nowrap"
              title={t("settings.barbell.barWeight", "Bar weight ({{unit}})", {
                unit: appState.unit,
              })}
            >
              <div className="w-full pl-10 sm:w-40 sm:shrink-0 sm:pl-0">
                <Stepper
                  className="w-full [&_button]:size-9"
                  value={barWeightFor(appState.unit, appState.plates)}
                  step={appState.unit === "lb" ? 5 : 2.5}
                  onChange={(bar) =>
                    update((state) => {
                      if (!state.plates) {
                        state.plates = defaultPlateSetup(state.unit);
                      }

                      state.plates.bar = bar ?? 0;
                    })
                  }
                />
              </div>
            </Row>
            <div className="w-full px-3.5 pt-1 pb-3.5">
              <div className="mb-2 text-sm leading-snug text-foreground/60">
                {t("settings.barbell.availablePlates", "Plates you have (per side)")}
              </div>
              <div className="flex flex-wrap gap-2">
                {COMMON_PLATES[appState.unit].map((plate) => {
                  const setup = effectivePlateSetup(appState.unit, appState.plates);
                  const active = setup.avail.includes(plate);

                  return (
                    <Button
                      variant="toggle"
                      key={plate}
                      type="button"
                      aria-pressed={active}
                      className="min-w-11"
                      onClick={() =>
                        update((state) => {
                          if (!state.plates) {
                            state.plates = defaultPlateSetup(state.unit);
                          }

                          state.plates.avail = active
                            ? state.plates.avail.filter((candidate) => candidate !== plate)
                            : [...state.plates.avail, plate];
                        })
                      }
                    >
                      {fmtPlate(plate)}
                    </Button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </Section>
      {(!!user || MOBILE) && (
        <NotificationsCard appState={appState} update={update} notify={toast} />
      )}
      <Section
        title={t("settings.appearance", "Appearance")}
        footer={DEMO || MOBILE ? null : t("settings.syncedProfile", "synced with your profile")}
      >
        <Row icon="moon" iconTint="var(--system-indigo)" title={t("settings.theme", "Theme")}>
          <Segmented<Theme>
            size="sm"
            className="min-w-33 flex-none"
            options={[
              { value: "dark", icon: "moon", label: t("settings.dark", "Dark") },
              { value: "light", icon: "sun", label: t("settings.light", "Light") },
            ]}
            value={appState.theme === "light" ? "light" : "dark"}
            onChange={(theme) => update((state) => void (state.theme = theme))}
          />
        </Row>
        <Row
          icon="figureStrength"
          iconTint="var(--system-teal)"
          title={t("muscleMap.bodyDiagram", "Body diagram")}
        >
          <Segmented<Body>
            size="sm"
            className="min-w-33 flex-none"
            options={[
              { value: "male", label: t("muscleMap.male", "Male") },
              { value: "female", label: t("muscleMap.female", "Female") },
            ]}
            value={appState.body === "female" ? "female" : "male"}
            onChange={(body) => update((state) => void (state.body = body))}
          />
        </Row>
        <div className="relative flex w-full flex-col items-stretch gap-3 px-3.5 pt-3 pb-3.5 text-left">
          <span className="text-lg leading-tight tracking-tight">
            {t("settings.accentColor", "Accent color")}
          </span>
          <div className="flex flex-wrap gap-3">
            {ACCENT_NAMES.map((accentName) => (
              <Button
                variant="swatch"
                type="button"
                key={accentName}
                data-accent-swatch={accentName}
                className="relative size-8 flex-none active:scale-90"
                onClick={() => update((state) => void (state.accent = accentName))}
                aria-label={accentName}
                aria-pressed={(appState.accent || DEFAULT_ACCENT) === accentName}
              />
            ))}
          </div>
        </div>
      </Section>
    </>
  );
}
