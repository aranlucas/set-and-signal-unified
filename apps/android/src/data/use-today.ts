import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { Session } from "../domain/workout";
import { nextCalendarRefreshAt } from "../domain/calendar";

/** Refresh calendar summaries at local midnight and after an app interruption. */
export function useToday(history: Session[]) {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setToday(now);
      timer = setTimeout(refresh, nextCalendarRefreshAt(history, now) - +now + 10);
    };

    // A changed history may contain a newly eligible or clock-clamped session.
    timer = setTimeout(refresh, 0);

    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") {
        refresh();
      }
    });

    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [history]);

  return today;
}
