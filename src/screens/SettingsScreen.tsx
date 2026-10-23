import { useState } from "react";
import {
  Column,
  ListItem,
  Row,
  Switch,
  Text,
  TextButton,
  ModalBottomSheet,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import {
  clickable,
  fillMaxWidth,
  paddingAll,
  toggleable,
  verticalScroll,
  weight,
} from "@expo/ui/jetpack-compose/modifiers";
import {
  Action,
  Caption,
  Choices,
  Divider,
  Heading,
  ListGroup,
  Page,
  Panel,
  SectionTitle,
} from "../components/ui";
import {
  LIFTS,
  NAMES,
  formatWeight,
  type AppState,
  type Lift,
  type Settings,
  type Unit,
} from "../domain/workout";

type Group = "equipment" | "progression" | "rest" | "appearance" | "data";
const titles: Record<Group, string> = {
  equipment: "Weights & equipment",
  progression: "Progression",
  rest: "Rest & focus",
  appearance: "Appearance",
  data: "Backup & export",
};
export function SettingsScreen({
  state,
  onSettings,
  onUnit,
  onWeight,
  onBar,
  onAlerts,
  onExport,
  onImport,
  onDone,
}: {
  state: AppState;
  onSettings: (settings: Partial<Settings>) => void;
  onUnit: (unit: Unit) => void;
  onWeight: (lift: Lift) => void;
  onBar: () => void;
  onAlerts: (enabled: boolean) => void;
  onExport: (format: "json" | "csv" | "share") => void;
  onImport: () => void;
  onDone: () => void;
}) {
  const { settings } = state;
  const [group, setGroup] = useState<Group | null>(null);
  const c = useMaterialColors();
  const openWeight = (lift: Lift) => {
    setGroup(null);
    onWeight(lift);
  };
  const rows: { group: Group; detail: string; value: string }[] = [
    {
      group: "equipment",
      detail: "Starting loads, increments, barbell",
      value: settings.unit,
    },
    {
      group: "progression",
      detail: "Automatic increases & deloads",
      value: settings.autoProgress ? "On" : "Manual",
    },
    {
      group: "rest",
      detail: "Timers, notifications & haptics",
      value: `${time(settings.restSeconds)} / ${time(settings.failedRestSeconds)}`,
    },
    {
      group: "appearance",
      detail: "Light, dark or follow your device",
      value:
        settings.theme === "system"
          ? "System"
          : settings.theme === "light"
            ? "Light"
            : "Dark",
    },
    {
      group: "data",
      detail: "Save, restore or share your workouts",
      value: `${state.history.length} logs`,
    },
  ];
  return (
    <>
      <Page>
        {!state.onboarded ? (
          <Panel>
            <Heading>Before your first workout</Heading>
            <Caption>
              Choose your units and starting weights, then you’re ready to lift.
            </Caption>
          </Panel>
        ) : null}
        <ListGroup>
          {rows.map((row, i) => (
            <Column key={row.group}>
              {i ? <Divider /> : null}
              <ListItem
                colors={{ containerColor: c.surfaceContainerLow }}
                modifiers={[clickable(() => setGroup(row.group))]}
              >
                <ListItem.HeadlineContent>
                  <Text
                    style={{ typography: "titleMedium", fontWeight: "600" }}
                  >
                    {titles[row.group]}
                  </Text>
                </ListItem.HeadlineContent>
                <ListItem.SupportingContent>
                  <Text>{row.detail}</Text>
                </ListItem.SupportingContent>
                <ListItem.TrailingContent>
                  <Text color={c.primary} style={{ typography: "labelLarge" }}>
                    {row.value}
                  </Text>
                </ListItem.TrailingContent>
              </ListItem>
            </Column>
          ))}
        </ListGroup>
        {!state.onboarded ? (
          <Action onPress={onDone}>Save setup & start lifting</Action>
        ) : null}
        <Caption>Fivefold {version} · Independent 5×5 training log</Caption>
        <Caption>
          Workouts stay on this device. Export a backup before switching phones
          or uninstalling.
        </Caption>
      </Page>
      {group ? (
        <ModalBottomSheet
          onDismissRequest={() => setGroup(null)}
          skipPartiallyExpanded
        >
          <Column
            modifiers={[fillMaxWidth(), paddingAll(24), verticalScroll()]}
            verticalArrangement={{ spacedBy: 16 }}
          >
            <Heading>{titles[group]}</Heading>
            {group === "equipment" ? (
              <>
                <SectionTitle>Units</SectionTitle>
                <Choices
                  values={[
                    { value: "lb", label: "Pounds" },
                    { value: "kg", label: "Kilograms" },
                  ]}
                  value={settings.unit}
                  onChange={onUnit}
                />
                <Caption>
                  {state.active
                    ? "Finish or discard your workout before changing units."
                    : "Future weights convert and round to standard increments. History keeps its original units."}
                </Caption>
                <Row
                  modifiers={[fillMaxWidth()]}
                  horizontalArrangement="spaceBetween"
                  verticalAlignment="center"
                >
                  <Text>Barbell weight</Text>
                  <TextButton
                    onClick={() => {
                      setGroup(null);
                      onBar();
                    }}
                  >
                    <Text
                      style={{ typography: "titleMedium", fontWeight: "600" }}
                    >
                      {formatWeight(settings.bar)} {settings.unit}
                    </Text>
                  </TextButton>
                </Row>
                <Divider />
                {LIFTS.map((lift) => (
                  <Row
                    key={lift}
                    modifiers={[fillMaxWidth()]}
                    horizontalArrangement="spaceBetween"
                    verticalAlignment="center"
                  >
                    <Column modifiers={[weight(1)]}>
                      <SectionTitle>{NAMES[lift]}</SectionTitle>
                      <Caption>
                        Increase {formatWeight(state.plans[lift].increment)}{" "}
                        {settings.unit}
                      </Caption>
                    </Column>
                    <TextButton onClick={() => openWeight(lift)}>
                      <Text
                        style={{ typography: "titleMedium", fontWeight: "600" }}
                      >
                        {formatWeight(state.plans[lift].weight)} {settings.unit}
                      </Text>
                    </TextButton>
                  </Row>
                ))}
                <Caption>
                  All weights include the bar. Choose loads you can lift with
                  good form.
                </Caption>
              </>
            ) : null}
            {group === "progression" ? (
              <>
                <SettingSwitch
                  label="Automatic increases"
                  detail="Add the chosen increment after completing every rep."
                  value={settings.autoProgress}
                  onChange={(v) => onSettings({ autoProgress: v })}
                />
                <Divider />
                <SettingSwitch
                  label="Deload after 3 misses"
                  detail="Reduce by 10%, rounded down to the increment. Skipped lifts do not add misses."
                  value={settings.autoDeload}
                  onChange={(v) => onSettings({ autoDeload: v })}
                />
              </>
            ) : null}
            {group === "rest" ? (
              <>
                <SectionTitle>After a successful set</SectionTitle>
                <Choices
                  values={[
                    { value: 90, label: "1:30" },
                    { value: 180, label: "3:00" },
                    { value: 300, label: "5:00" },
                  ]}
                  value={settings.restSeconds}
                  onChange={(v) => onSettings({ restSeconds: v })}
                />
                <SectionTitle>After a missed rep</SectionTitle>
                <Choices
                  values={[
                    { value: 180, label: "3:00" },
                    { value: 300, label: "5:00" },
                    { value: 600, label: "10:00" },
                  ]}
                  value={settings.failedRestSeconds}
                  onChange={(v) => onSettings({ failedRestSeconds: v })}
                />
                <Divider />
                <SettingSwitch
                  label="Workout notifications"
                  detail="Shows your workout in the notification shade and alerts when rest ends, even with the screen off."
                  value={settings.restAlerts}
                  onChange={onAlerts}
                />
                <SettingSwitch
                  label="Haptic feedback"
                  detail="Feedback when you log a set."
                  value={settings.haptics}
                  onChange={(v) => onSettings({ haptics: v })}
                />
                <SettingSwitch
                  label="Keep screen awake"
                  detail="During an active workout."
                  value={settings.keepAwake}
                  onChange={(v) => onSettings({ keepAwake: v })}
                />
              </>
            ) : null}
            {group === "appearance" ? (
              <Choices
                values={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
                value={settings.theme}
                onChange={(v) => onSettings({ theme: v })}
              />
            ) : null}
            {group === "data" ? (
              <>
                <Caption>
                  JSON backups include your history, active workout, and
                  settings. CSV is a readable set-by-set log.
                </Caption>
                <Action
                  onPress={() => {
                    setGroup(null);
                    onExport("json");
                  }}
                  secondary
                >
                  Export backup
                </Action>
                <Action
                  onPress={() => {
                    setGroup(null);
                    onImport();
                  }}
                  secondary
                >
                  Restore backup
                </Action>
                <Action
                  onPress={() => {
                    setGroup(null);
                    onExport("csv");
                  }}
                  subtle
                >
                  Export readable CSV
                </Action>
                <Action
                  onPress={() => {
                    setGroup(null);
                    onExport("share");
                  }}
                  subtle
                >
                  Share backup
                </Action>
              </>
            ) : null}
            <Action onPress={() => setGroup(null)} subtle>
              Done
            </Action>
          </Column>
        </ModalBottomSheet>
      ) : null}
    </>
  );
}
function SettingSwitch({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  // Material pattern: the whole row is one switch target for touch and TalkBack.
  return (
    <Row
      modifiers={[
        fillMaxWidth(),
        toggleable(value, () => onChange(!value), { role: "switch" }),
      ]}
      horizontalArrangement={{ spacedBy: 12 }}
      verticalAlignment="center"
    >
      <Column modifiers={[weight(1)]} verticalArrangement={{ spacedBy: 4 }}>
        <SectionTitle>{label}</SectionTitle>
        <Caption>{detail}</Caption>
      </Column>
      <Switch value={value} />
    </Row>
  );
}
const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
import { version } from "../../package.json";
