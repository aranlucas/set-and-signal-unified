import { NAMES, type AppState } from "./workout";

export function toCSV(state: AppState) {
  const rows: (string | number)[][] = [
    ["Date", "Workout", "Exercise", "Weight", "Unit", "Set", "Reps", "Notes"],
  ];

  for (const s of state.history.toReversed()) {
    for (const e of s.exercises) {
      const finishedAt = s.finishedAt ?? s.startedAt;

      for (const [i, reps] of e.sets.entries()) {
        rows.push([
          new Date(finishedAt).toISOString(),
          s.kind,
          NAMES[e.lift],
          e.weight,
          s.unit,
          i + 1,
          reps ?? "",
          s.notes,
        ]);
      }
    }
  }

  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell);
          const value = !Number.isFinite(cell) && /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;

          return `"${value.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
