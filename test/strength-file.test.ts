import {
  CrcCalculator,
  Encoder,
  type FileIdMesg,
  type RecordMesg,
  type SetMesg,
} from "@garmin/fitsdk";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { env } from "cloudflare:workers";
import { expect, it, onTestFinished, vi } from "vitest";
import { createServer } from "../src/mcp";
import { userStore } from "../src/push/store";
import {
  decodeStrengthActivityFile,
  MAX_FIT_BYTES,
  MAX_FIT_MESSAGES,
  MAX_STRENGTH_SETS,
  MAX_EXERCISE_ENTRIES,
} from "../src/activity/strength";

// Synthetic fixtures encoded by Garmin's SDK, not exports from a real user's watch.
function fixture(sets: SetMesg[], type: FileIdMesg["type"] = "activity") {
  const encoder = new Encoder();
  const file: FileIdMesg = { type, manufacturer: "development", product: 1 };
  encoder.onMesg(0, file);

  for (const set of sets) {
    encoder.onMesg(225, set);
  }

  return Buffer.from(encoder.close()).toString("base64");
}

it("decodes observed reps, fractional kg, exercise arrays and explicit rest records", () => {
  const result = decodeStrengthActivityFile(
    fixture([
      {
        messageIndex: 0,
        wktStepIndex: 3,
        setType: "active",
        startTime: new Date("2026-10-24T10:00:00Z"),
        timestamp: new Date("2026-10-24T10:00:30Z"),
        duration: 30.5,
        repetitions: 8,
        weight: 22.5,
        weightDisplayUnit: "pound",
        category: ["benchPress", "squat"],
        categorySubtype: [0, 0],
      },
      { setType: "rest", duration: 60.25 },
    ]),
  );

  expect(result.availability).toBe("recorded_sets");
  expect(result.sets).toHaveLength(2);
  expect(result.sets[0]).toMatchObject({
    index: 0,
    messageIndex: 0,
    workoutStepIndex: 3,
    setType: "active",
    startTimeUtc: "2026-10-24T10:00:00.000Z",
    recordedTimestampUtc: "2026-10-24T10:00:30.000Z",
    durationSeconds: 30.5,
    repetitions: 8,
    weightKg: 22.5,
    weightDisplayUnit: "pound",
    exercises: [
      { category: "benchPress", subtypeId: 0, name: "alternatingDumbbellChestPressOnSwissBall" },
      { category: "squat", subtypeId: 0, name: "legPress" },
    ],
  });
  expect(result.sets[1]).toMatchObject({
    index: 1,
    setType: "rest",
    durationSeconds: 60.25,
    repetitions: null,
    weightKg: null,
  });
});

it("preserves zero, missing, unknown, and unmatched exercise identifiers without inventing values", () => {
  const result = decodeStrengthActivityFile(
    fixture([
      { setType: "active", repetitions: 0, weight: 0, duration: 0 },
      { setType: 7, category: [60000, "benchPress"], categorySubtype: [123, 60000, 2] },
      { startTime: 10, timestamp: 20 },
    ]),
  );

  expect(result.sets[0]).toMatchObject({ repetitions: 0, weightKg: 0, durationSeconds: 0 });
  expect(result.sets[1]).toMatchObject({
    setTypeId: 7,
    setType: null,
    repetitions: null,
    weightKg: null,
    exercises: [
      { categoryId: 60000, category: null, subtypeId: 123, name: null },
      { category: "benchPress", subtypeId: 60000, name: null },
      { categoryId: null, category: null, subtypeId: 2, name: null },
    ],
  });
  expect(result.sets[2]).toMatchObject({ startTimeUtc: null, recordedTimestampUtc: null });
});

it("reports absence as unavailable and rejects planned workout files", () => {
  const result = decodeStrengthActivityFile(fixture([]));
  expect(result.availability).toBe("no_recorded_sets");
  expect(result.sets).toEqual([]);
  expect(() => decodeStrengthActivityFile(fixture([], "workout"))).toThrow("recorded FIT activity");
});

it.each([
  "",
  "https://garmin.example/file",
  "data:application/fit;base64,AAAA",
  "A===",
  "Zh==",
  "AAAA\n",
  "AA",
])("rejects non-canonical base64 input %s", (input) => {
  expect(() => decodeStrengthActivityFile(input)).toThrow("canonical base64");
});

it("rejects ZIP, corrupt CRC, truncated files, trailing data and oversize input", () => {
  const valid = Buffer.from(fixture([{ setType: "active", repetitions: 10 }]), "base64");
  const corrupt = Buffer.from(valid);
  corrupt[corrupt.length - 1] = (corrupt.at(-1) ?? 0) ^ 1;

  for (const bytes of [Buffer.from("PK\u0003\u0004not-a-fit"), corrupt, valid.subarray(0, -1)]) {
    expect(() => decodeStrengthActivityFile(bytes.toString("base64"))).toThrow("valid FIT");
  }

  expect(() =>
    decodeStrengthActivityFile(Buffer.concat([valid, valid]).toString("base64")),
  ).toThrow("exactly one FIT");
  expect(() =>
    decodeStrengthActivityFile(Buffer.alloc(MAX_FIT_BYTES + 1).toString("base64")),
  ).toThrow("up to 1 MiB");
});

it("bounds set and total message counts before returning any partial results", () => {
  expect(() =>
    decodeStrengthActivityFile(
      fixture(
        Array.from({ length: MAX_STRENGTH_SETS + 1 }, () => ({
          setType: "active",
          repetitions: 1,
        })),
      ),
    ),
  ).toThrow("2,000 set records");
  const encoder = new Encoder();
  const file: FileIdMesg = { type: "activity" };
  encoder.onMesg(0, file);
  const sample: RecordMesg = { heartRate: 100 };

  for (let i = 0; i < MAX_FIT_MESSAGES; i += 1) {
    encoder.onMesg(20, sample);
  }

  expect(() => decodeStrengthActivityFile(Buffer.from(encoder.close()).toString("base64"))).toThrow(
    "25,000 messages",
  );
});

function appendFixtureData(base64: string, extraData: Uint8Array) {
  const base = Buffer.from(base64, "base64");

  // The SDK encoder cannot emit unknown messages. Add a valid zero-field definition and use
  // its CRC implementation, rather than maintaining another binary FIT encoder for tests.
  const body = Buffer.concat([base.subarray(14, -2), extraData]);

  const bytes = Buffer.concat([base.subarray(0, 14), body, Buffer.alloc(2)]);
  bytes.writeUInt32LE(body.length, 4);
  bytes.writeUInt16LE(CrcCalculator.calculateCRC(bytes, 0, 12), 12);
  bytes.writeUInt16LE(CrcCalculator.calculateCRC(bytes, 0, bytes.length - 2), bytes.length - 2);

  return bytes.toString("base64");
}

it("counts unknown FIT messages and definitions toward the decoding limit", () => {
  const definition = Buffer.from([0x41, 0, 0, 0xe8, 0xfd, 0]);
  const unknownMessages = Buffer.concat([definition, Buffer.alloc(MAX_FIT_MESSAGES, 1)]);
  expect(() => decodeStrengthActivityFile(appendFixtureData(fixture([]), unknownMessages))).toThrow(
    "25,000 messages",
  );
  const definitions = Buffer.concat(Array.from({ length: MAX_FIT_MESSAGES }, () => definition));
  expect(() => decodeStrengthActivityFile(appendFixtureData(fixture([]), definitions))).toThrow(
    "25,000 messages",
  );
});

it("bounds aggregate exercise entries before expanding the output", () => {
  const sets = Array.from({ length: Math.ceil((MAX_EXERCISE_ENTRIES + 1) / 127) }, (): SetMesg => ({
    setType: "active",
    category: Array.from({ length: 127 }, () => 35),
    categorySubtype: Array.from({ length: 127 }, () => 30),
  }));

  expect(() => decodeStrengthActivityFile(fixture(sets))).toThrow("4,000 exercise entries");
});

it("rejects unsupported compressed timestamps without returning earlier decoded sets", () => {
  const base = fixture([{ setType: "active", repetitions: 8 }]);
  // CRC-valid FIT compressed-timestamp header, unsupported by the pinned official decoder.
  expect(() => decodeStrengthActivityFile(appendFixtureData(base, Buffer.from([0x80])))).toThrow(
    "no partial sets",
  );
});

it("preserves single-element arrays and interior invalid-value positions", () => {
  const result = decodeStrengthActivityFile(
    fixture([
      { category: ["squat"], categorySubtype: [0] },
      {
        category: ["benchPress", 65535, "squat"],
        categorySubtype: [0, 65535, 0],
        weight: 65535 / 16,
        repetitions: 65535,
      },
    ]),
  );

  expect(result.sets[0]?.exercises).toEqual([
    { categoryId: 28, category: "squat", subtypeId: 0, name: "legPress" },
  ]);
  expect(result.sets[1]).toMatchObject({
    weightKg: null,
    repetitions: null,
    exercises: [
      { category: "benchPress", subtypeId: 0 },
      { categoryId: null, category: null, subtypeId: null, name: null },
      { category: "squat", subtypeId: 0 },
    ],
  });
});

it("exposes file decoding through the main MCP server without network calls or storage", async () => {
  const store = userStore(env, crypto.randomUUID());
  const fetcher = vi.fn<typeof fetch>();
  const server = createServer("never-return-this-token", store, fetcher);
  const client = new Client({ name: "strength-file-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  expect(
    tools.tools.find((tool) => tool.name === "decode_strength_activity_file")?.annotations,
  ).toMatchObject({ readOnlyHint: true, openWorldHint: false, destructiveHint: false });

  const result = await client.callTool({
    name: "decode_strength_activity_file",
    arguments: { fitBase64: fixture([{ setType: "active", repetitions: 5, weight: 20 }]) },
  });

  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    source: "User-supplied FIT activity file",
    sets: [{ repetitions: 5, weightKg: 20 }],
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    (await store.list("activityDetails", "2026-10-24", "2026-10-24", 50, 0)).records,
  ).toHaveLength(0);

  const bad = await client.callTool({
    name: "decode_strength_activity_file",
    arguments: { fitBase64: Buffer.from("private-malformed-payload").toString("base64") },
  });

  expect(bad.isError).toBe(true);
  expect(JSON.stringify(bad)).not.toContain("private-malformed-payload");
  expect(JSON.stringify(result)).not.toContain("never-return-this-token");
});
