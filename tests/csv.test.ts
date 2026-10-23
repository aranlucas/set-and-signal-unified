import { describe, expect, it } from "vitest";
import { toCSV } from "../src/domain/csv";
import {
  finishSession,
  initialState,
  logSet,
  startSession,
} from "../src/domain/workout";

function history(note: string) {
  let s = startSession(initialState("kg"), 1792650000000);
  s = logSet(s, "squat", 0, 0, 1792650001000);
  s.active!.notes = note;
  return finishSession(s, 1792650002000);
}
describe("readable CSV export", () => {
  it("distinguishes an attempted zero from an unlogged set", () => {
    const lines = toCSV(history("")).split("\r\n");
    expect(lines).toHaveLength(16);
    expect(lines[1]).toContain('"1","0"');
    expect(lines[2]).toContain('"2",""');
  });
  it("quotes commas, quotes and line breaks in notes", () => {
    expect(toCSV(history('Good, "strong"\nToday'))).toContain(
      '"Good, ""strong""\nToday"',
    );
  });
  it.each(["=1+2", "+SUM(A1:A2)", "-1+2", "@SUM(A1:A2)", "\t=1+2"])(
    "neutralizes spreadsheet formulas in a note",
    (note) => {
      expect(toCSV(history(note))).toContain(`"'${note}"`);
    },
  );
});
