import { parseStoredState, validateState } from "../../src/domain/backup";
import { type AppState } from "../../src/domain/workout";

let row: string;

let persistedHistory: AppState["history"];

let history: AppState["history"];

export function resetStorage(state: AppState) {
  row = JSON.stringify({ ...state, history: [] });
  history = structuredClone(state.history);
  persistedHistory = history;
}

export function loadState(): AppState {
  const state = validateState({ ...parseStoredState(row), history });
  persistedHistory = state.history;

  return state;
}

export function saveState(state: AppState) {
  row = JSON.stringify({ ...state, history: [] });

  if (state.history !== persistedHistory) {
    history = structuredClone(state.history);
  }

  persistedHistory = state.history;
}

export function savedState(): AppState {
  return validateState({ ...parseStoredState(row), history });
}
