import { useCallback, useRef, useState } from "react";
import { initialState, type AppState } from "../domain/workout";
import { loadState, saveState } from "./storage";

export function useWorkoutStore() {
  const [loaded] = useState(() => {
    try {
      return { state: loadState(), error: "" };
    } catch (e) {
      return {
        state: initialState(),
        error:
          e instanceof Error ? e.message : "Could not open workout storage.",
      };
    }
  });
  const [state, setState] = useState(loaded.state);
  const [error, setError] = useState(loaded.error);
  const [ready, setReady] = useState(!loaded.error);
  const current = useRef(state);
  const commit = useCallback(
    (update: (s: AppState) => AppState): boolean => {
      if (!ready) return false;
      const next = update(current.current);
      if (next === current.current) return true;
      try {
        saveState(next);
        current.current = next;
        setState(next);
        setError("");
        return true;
      } catch {
        setError(
          "This change could not be saved. Free some device storage and try again. Your previously saved workout is safe.",
        );
        return false;
      }
    },
    [ready],
  );
  const retry = useCallback(() => {
    try {
      const s = loadState();
      current.current = s;
      setState(s);
      setReady(true);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not open workout storage.",
      );
    }
  }, []);
  return { state, commit, error, ready, retry };
}
