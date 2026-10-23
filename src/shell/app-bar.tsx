import BackIcon from "@expo/material-symbols/arrow_back.xml";
import {
  Button,
  Icon,
  IconButton,
  Text,
  TextButton,
  TopAppBar,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { padding } from "@expo/ui/jetpack-compose/modifiers";
import { useAppState } from "../data/store";
import { undoLoggedSet } from "../data/actions";
import type { UndoSet } from "../domain/commands";
import { loggedSets } from "../domain/workout";
import type { Tab } from "./types";

interface AppBarProps {
  tab: Tab;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  setTab: (tab: Tab) => void;
  undo: UndoSet | null;
  setUndo: (undo: UndoSet | null) => void;
  finish: () => void;
}

export function AppBar({
  tab,
  selectedId,
  setSelectedId,
  setTab,
  undo,
  setUndo,
  finish,
}: AppBarProps) {
  const c = useMaterialColors();
  const activeId = useAppState((s) => s.active?.id);
  const kind = useAppState((s) => s.active?.kind);
  const exercises = useAppState((s) => s.active?.exercises);

  const active =
    activeId !== undefined && kind !== undefined && exercises
      ? { id: activeId, kind, exercises }
      : null;

  const selected = useAppState((s) =>
    selectedId === null ? undefined : s.history.find((session) => session.id === selectedId),
  );

  return (
    <TopAppBar
      key={`${selectedId ?? "root"}-${tab}-${active ? "active" : "idle"}`}
      colors={{ containerColor: c.background }}
    >
      <TopAppBar.Title>
        <Text style={{ typography: "titleLarge", fontWeight: "600" }}>
          {selected
            ? "Details"
            : tab === "Train"
              ? active
                ? `Workout ${active.kind}`
                : "Fivefold"
              : tab}
        </Text>
      </TopAppBar.Title>
      {selected ? (
        <TopAppBar.NavigationIcon>
          <IconButton onClick={() => setSelectedId(null)}>
            <Icon source={BackIcon} contentDescription="Back to history" />
          </IconButton>
        </TopAppBar.NavigationIcon>
      ) : null}
      {active && tab === "Train" ? (
        <TopAppBar.Actions>
          {undo?.sessionId === active.id ? (
            <TextButton
              onClick={() => {
                undoLoggedSet(undo);
                setUndo(null);
              }}
            >
              <Text>Undo</Text>
            </TextButton>
          ) : null}
          <Button
            onClick={finish}
            enabled={loggedSets(active) > 0}
            // Filled actions need the app bar's 16 dp edge, not the 4 dp icon inset.
            modifiers={[padding(0, 0, 12, 0)]}
          >
            <Text>Finish</Text>
          </Button>
        </TopAppBar.Actions>
      ) : null}
      {active && tab !== "Train" ? (
        <TopAppBar.Actions>
          <TextButton
            onClick={() => {
              setTab("Train");
              setSelectedId(null);
            }}
          >
            <Text>Resume</Text>
          </TextButton>
        </TopAppBar.Actions>
      ) : null}
    </TopAppBar>
  );
}
