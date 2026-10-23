import { useLayoutEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { Host } from "@expo/ui/jetpack-compose";
import { Application } from "./src/shell/AppShell";
import { useAppState, useStorageStatus } from "./src/data/store";
import { perfCommitted } from "./src/perf";

export default function App() {
  const theme = useAppState((state) => state.settings.theme);
  return (
    <Host
      style={{ flex: 1 }}
      seedColor="#216B53"
      colorScheme={theme === "system" ? undefined : theme}
    >
      <StatusBar
        style={theme === "dark" ? "light" : theme === "light" ? "dark" : "auto"}
      />
      <Application />
      {process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1" ? <PerfObserver /> : null}
    </Host>
  );
}
// The static gate above removes this root observer from normal builds.
function PerfObserver() {
  const state = useAppState((state) => state);
  const ready = useStorageStatus("ready");
  useLayoutEffect(() => perfCommitted(state, ready), [state, ready]);
  return null;
}
