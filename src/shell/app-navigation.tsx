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

interface AppNavigationProps {
  tab: Tab;
  setTab: (tab: Tab) => void;
  setSelectedId: (id: string | null) => void;
}

const icons = {
  Train: TrainIcon,
  History: HistoryIcon,
  Progress: ProgressIcon,
  Settings: SettingsIcon,
};

const tabs: Tab[] = ["Train", "History", "Progress", "Settings"];

export function AppNavigation({ tab, setTab, setSelectedId }: AppNavigationProps) {
  const c = useMaterialColors();

  return (
    <NavigationBar containerColor={c.surfaceContainerLow}>
      {tabs.map((t) => (
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
