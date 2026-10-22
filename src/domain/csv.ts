import { NAMES, type AppState } from "./workout";

export function toCSV(state: AppState) {
  const rows: (string | number)[][] = [
    ["Date", "Workout", "Exercise", "Weight", "Unit", "Set", "Reps", "Notes"],
  ];
  for (const s of [...state.history].reverse())
    for (const e of s.exercises)
      e.sets.forEach((reps, i) =>
        rows.push([
          new Date(s.finishedAt!).toISOString(),
          s.kind,
          NAMES[e.lift],
          e.weight,
          s.unit,
          i + 1,
          reps ?? "",
          s.notes,
        ]),
      );
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value =
            typeof cell === "string" && /^[=+@\-\t\r]/.test(cell)
              ? `'${cell}`
              : String(cell);
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
