import { describe, expect, it } from "vitest";
import {
  parseAmStart,
  parseArguments,
  parseGfxinfo,
  parsePerfLine,
  parsePss,
  parseUiNodes,
  percentile,
  summarize,
} from "../measure-device.mjs";

describe("device measurement parsers (no adb calls)", () => {
  it("reads Android cold-start timings and rejects a failed/warm launch", () => {
    expect(
      parseAmStart(`Starting: Intent { cmp=app.fivefold.lifts/.MainActivity }
Status: ok
LaunchState: COLD
Activity: app.fivefold.lifts/.MainActivity
TotalTime: 1432
WaitTime: 1460
Complete`),
    ).toEqual({ totalTimeMs: 1432, waitTimeMs: 1460 });
    expect(() => parseAmStart("Status: timeout\nWaitTime: 10000")).toThrow();
    expect(() =>
      parseAmStart(
        "Status: ok\nActivity not started, intent delivered\nWaitTime: 12",
      ),
    ).toThrow();
  });
  it("reads gfxinfo totals, percentages, and frame percentiles", () => {
    expect(
      parseGfxinfo(`Applications Graphics Acceleration Info:
** Graphics info for pid 28471 [app.fivefold.lifts] **
Stats since: 186419882176ns
Total frames rendered: 214
Janky frames: 17 (7.94%)
Janky frames (legacy): 20 (9.35%)
50th percentile: 8ms
90th percentile: 19ms
95th percentile: 25ms
99th percentile: 64ms
Number Missed Vsync: 9`),
    ).toEqual({
      totalFrames: 214,
      jankyFrames: 17,
      jankyPercent: 7.94,
      p50Ms: 8,
      p90Ms: 19,
      p95Ms: 25,
      p99Ms: 64,
    });
    expect(() =>
      parseGfxinfo("No process found for: app.fivefold.lifts"),
    ).toThrow();
  });
  it("extracts TOTAL PSS from modern and older meminfo formats", () => {
    expect(
      parsePss(" App Summary\n TOTAL PSS: 184,280     TOTAL RSS: 277120"),
    ).toBe(184280);
    expect(parsePss("        TOTAL   184280  154000   30000  1234")).toBe(
      184280,
    );
    expect(() => parsePss("No process found")).toThrow();
  });
  it("decodes UI descriptions and bounds, retaining offscreen/disabled nodes", () => {
    const nodes = parseUiNodes(
      `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="Start workout A" content-desc="" enabled="true" bounds="[32,1550][1048,1646]"><node text="" content-desc="Squat, set 1 of 5, not logged. Tap to log 5 reps" bounds="[48,400][192,544]"/><node text="Weights &amp; equipment &quot;kg&quot;" content-desc="Warm-up &amp; plates" enabled="false" bounds="[-20,2100][100,2200]"/></node></hierarchy>`,
    );
    expect(nodes[0]).toMatchObject({
      text: "Start workout A",
      x: 540,
      y: 1598,
    });
    expect(nodes[1]).toMatchObject({
      description: "Squat, set 1 of 5, not logged. Tap to log 5 reps",
      x: 120,
      y: 472,
      bounds: { left: 48, top: 400, right: 192, bottom: 544 },
    });
    expect(nodes[2]).toMatchObject({
      text: 'Weights & equipment "kg"',
      enabled: false,
      x: 40,
    });
    expect(() => parseUiNodes("ERROR: could not get idle state")).toThrow();
    expect(() =>
      parseUiNodes('<hierarchy><node bounds="bad"/></hierarchy>'),
    ).toThrow();
  });
  it("reads only complete valid measurement records from logcat", () => {
    expect(
      parsePerfLine(
        'I/ReactNativeJS(28471): FIVEFOLD_PERF {"name":"commit.render","ms":12.345}',
      ),
    ).toEqual({ name: "commit.render", ms: 12.345 });
    expect(
      parsePerfLine(
        '10-22 12:42:17.004 28471 28501 I ReactNativeJS: FIVEFOLD_PERF {"name":"startup.seed","ms":240,"sessions":10000}',
      ),
    ).toMatchObject({ name: "startup.seed", sessions: 10000 });
    for (const line of [
      "normal message",
      'FIVEFOLD_PERF {"name":',
      'FIVEFOLD_PERF {"name":"bad","ms":-1}',
      'FIVEFOLD_PERF {"ms":12}',
      'FIVEFOLD_PERF {"name":"bad","ms":null}',
    ])
      expect(parsePerfLine(line)).toBeNull();
  });
  it("uses nearest-rank percentiles without mutating samples", () => {
    const values = [7, 1, 5, 3, 2];
    expect(percentile(values, 0.5)).toBe(3);
    expect(percentile(values, 0.95)).toBe(7);
    expect(percentile([8], 0)).toBe(8);
    expect(values).toEqual([7, 1, 5, 3, 2]);
    expect(summarize(values)).toEqual({ count: 5, p50: 3, p95: 7, max: 7 });
    expect(() => percentile([], 0.5)).toThrow();
  });
  it("requires an explicit target/APK and safe label and positive run counts", () => {
    expect(
      parseArguments([
        "--serial",
        "emulator-5554",
        "--apk",
        "/tmp/Fivefold.apk",
        "--label",
        "baseline",
      ]),
    ).toMatchObject({ starts: 15, workouts: 3 });
    for (const args of [
      [],
      ["--label", "../bad"],
      ["--serial", "x", "--apk", "x", "--label", "baseline", "--starts", "0"],
    ])
      expect(() => parseArguments(args)).toThrow();
  });
});
