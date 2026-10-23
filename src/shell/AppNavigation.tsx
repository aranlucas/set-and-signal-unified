import TrainIcon from "@expo/material-symbols/fitness_center.xml";
import HistoryIcon from "@expo/material-symbols/history.xml";
import ProgressIcon from "@expo/material-symbols/monitoring.xml";
import SettingsIcon from "@expo/material-symbols/settings.xml";
import {
  Icon,
  NavigationBar,
  NavigationBarItem,
  Text,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import type { Tab } from "./types";
const icons = {
  Train: TrainIcon,
  History: HistoryIcon,
  Progress: ProgressIcon,
  Settings: SettingsIcon,
};

export function AppNavigation({
  tab,
  setTab,
  setSelectedId,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const c = useMaterialColors();
  return (
    <NavigationBar containerColor={c.surfaceContainerLow}>
      {(Object.keys(icons) as Tab[]).map((t) => (
        <NavigationBarItem
          key={t}
          selected={tab === t}
          onClick={() => {
            setTab(t);
            setSelectedId(null);
          }}
        >
          <NavigationBarItem.Icon>
            <Icon source={icons[t]} />
          </NavigationBarItem.Icon>
          <NavigationBarItem.Label>
            <Text
              style={{ typography: "labelMedium" }}
              maxLines={1}
              softWrap={false}
              overflow="ellipsis"
            >
              {t}
            </Text>
          </NavigationBarItem.Label>
        </NavigationBarItem>
      ))}
    </NavigationBar>
  );
}
