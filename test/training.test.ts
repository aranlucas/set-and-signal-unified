import {
  Client,
  InMemoryTransport,
  type CallToolRequestParams,
} from "@modelcontextprotocol/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  onTestFinished,
  vi,
} from "vitest";
import * as z from "zod";
import { TrainingClient, TrainingError } from "../src/training/client";
import { createTrainingServer } from "../src/training/mcp";
import {
  createWorkoutInput,
  listSchedulesInput,
  scheduleResponse,
  scheduleWorkoutInput,
  trainingId,
  workoutInput,
  workoutResponse,
  workoutWriteResponse,
  scheduleWriteResponse,
  mutationAccepted,
  workoutStep,
  type WorkoutInput,
} from "../src/training/schemas";
import { requestUrl, required } from "./support";

const accessToken = "fake-training-access-token-test-only";

const privateValue = "fake-private-upstream-value-test-only";

const permissionsUrl = "https://apis.garmin.com/partner-gateway/rest/user/permissions";

// Fixtures follow Training API V2 2.0 sections 3–4 and OAuth2PKCE 2.0 section 8.
const activeStep = {
  type: "WorkoutStep",
  stepOrder: 1,
  intensity: "ACTIVE",
  durationType: "TIME",
  durationValue: 600,
  targetType: "OPEN",
} satisfies z.input<typeof workoutStep>;

const workout = {
  workoutName: "Test interval session",
  sport: "RUNNING",
  segments: [
    {
      segmentOrder: 1,
      sport: "RUNNING",
      steps: [
        { ...activeStep, intensity: "WARMUP" },
        {
          type: "WorkoutRepeatStep",
          stepOrder: 2,
          repeatType: "REPEAT_UNTIL_STEPS_CMPLT",
          repeatValue: 4,
          steps: [
            {
              ...activeStep,
              stepOrder: 3,
              durationValue: 60,
              targetType: "PACE",
              targetValueLow: 3,
              targetValueHigh: 3.5,
            },
            { ...activeStep, stepOrder: 4, intensity: "RECOVERY", durationValue: 90 },
          ],
        },
        { ...activeStep, stepOrder: 5, intensity: "COOLDOWN" },
      ],
    },
  ],
} satisfies WorkoutInput;

const publishedWorkout = { ...workout, ownerId: 52, workoutId: 871 };

const schedule = { workoutId: publishedWorkout.workoutId, date: "2026-10-25" };

const publishedSchedule = { ...schedule, scheduleId: 472 };

function responses(...values: Response[]) {
  const fetcher = vi.fn<typeof fetch>();

  for (const value of values) {
    fetcher.mockResolvedValueOnce(value);
  }

  fetcher.mockRejectedValue(new Error("Unexpected mocked Garmin request"));

  return fetcher;
}

async function connect(fetcher: typeof fetch): Promise<Client> {
  const server = createTrainingServer(accessToken, fetcher);
  const client = new Client({ name: "training-protocol-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  onTestFinished(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

type ToolScenario = CallToolRequestParams & { response: unknown };

const toolCalls = [
  { name: "create_workout", arguments: { workout }, response: publishedWorkout },
  {
    name: "update_workout",
    arguments: { workoutId: 871, ownerId: 52, workout },
    response: publishedWorkout,
  },
  { name: "delete_workout", arguments: { workoutId: 871 }, response: { accepted: true } },
  {
    name: "update_workout_schedule",
    arguments: { scheduleId: 472, ...schedule },
    response: publishedSchedule,
  },
  { name: "delete_workout_schedule", arguments: { scheduleId: 472 }, response: { accepted: true } },
  { name: "get_workout", arguments: { workoutId: 871 }, response: publishedWorkout },
  { name: "schedule_workout", arguments: schedule, response: publishedSchedule },
  {
    name: "get_workout_schedule",
    arguments: { scheduleId: 472 },
    response: publishedSchedule,
  },
  {
    name: "list_workout_schedules",
    arguments: { startDate: "2026-10-01", endDate: "2026-10-31" },
    response: [publishedSchedule],
  },
] satisfies ToolScenario[];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Training MCP protocol", () => {
  it("lists all nine separate tools with write and read annotations", async () => {
    const fetcher = responses();
    const client = await connect(fetcher);
    const list = await client.listTools();

    expect(list.tools.map((tool) => tool.name).toSorted()).toEqual(
      toolCalls.map((tool) => tool.name).toSorted(),
    );

    for (const tool of list.tools) {
      const write = !["get_workout", "get_workout_schedule", "list_workout_schedules"].includes(
        tool.name,
      );

      expect(tool.annotations, tool.name).toEqual({
        readOnlyHint: !write,
        destructiveHint: tool.name.startsWith("delete_") || tool.name.startsWith("update_"),
        idempotentHint: !write,
        openWorldHint: true,
      });
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }

    expect(client.getInstructions()).toContain("does not confirm watch delivery");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("creates then schedules the returned workout ID with exact official requests and structured results", async () => {
    const fetcher = responses(
      Response.json({ permissions: ["WORKOUT_IMPORT"] }),
      Response.json(publishedWorkout),
      Response.json({ permissions: ["WORKOUT_IMPORT"] }),
      Response.json(publishedSchedule),
    );

    const client = await connect(fetcher);
    const created = await client.callTool({ name: "create_workout", arguments: { workout } });
    const createdData = z.object({ data: workoutResponse }).parse(created.structuredContent);

    const scheduled = await client.callTool({
      name: "schedule_workout",
      arguments: { workoutId: createdData.data.workoutId, date: schedule.date },
    });

    expect(created.isError).not.toBe(true);
    expect(scheduled.isError).not.toBe(true);
    expect(created.structuredContent).toMatchObject({
      source: "Garmin Connect",
      data: publishedWorkout,
      deviceSync:
        "Sync Garmin Connect with your compatible device to download the workout. Watch delivery has not been confirmed.",
    });
    expect(scheduled.structuredContent).toMatchObject({
      source: "Garmin Connect",
      data: publishedSchedule,
      deviceSync:
        "Sync Garmin Connect with your compatible device to download the workout. Watch delivery has not been confirmed.",
    });

    for (const result of [created, scheduled]) {
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(result.structuredContent) },
      ]);
      expect(JSON.stringify(result)).not.toContain(accessToken);
    }

    expect(
      fetcher.mock.calls.map(([input, init]) => ({
        url: requestUrl(input),
        method: init?.method,
        body: init?.body,
      })),
    ).toEqual([
      { url: permissionsUrl, method: "GET", body: undefined },
      {
        url: "https://apis.garmin.com/workoutportal/workout/v2",
        method: "POST",
        body: JSON.stringify(workoutInput.parse(workout)),
      },
      { url: permissionsUrl, method: "GET", body: undefined },
      {
        url: "https://apis.garmin.com/training-api/schedule/",
        method: "POST",
        body: JSON.stringify(schedule),
      },
    ]);

    for (const [, init] of fetcher.mock.calls) {
      const headers = new Headers(init?.headers);

      expect(headers.get("Authorization")).toBe(`Bearer ${accessToken}`);
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("Content-Type")).toBe(init?.method === "POST" ? "application/json" : null);
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([
    { name: "create_workout", arguments: { workout } },
    { name: "schedule_workout", arguments: schedule },
  ])("makes no $name write request when Workout Import permission is absent", async (call) => {
    const fetcher = responses(Response.json({ permissions: ["ACTIVITY_EXPORT"] }));
    const client = await connect(fetcher);
    const result = await client.callTool(call);

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("Workout Import permission is missing");
    expect(result.structuredContent).toBeUndefined();
    expect(fetcher.mock.calls.map(([input]) => requestUrl(input))).toEqual([permissionsUrl]);
  });

  it.each(toolCalls)("checks permission again after revocation for $name", async (call) => {
    const fetcher = responses(
      Response.json({ permissions: ["WORKOUT_IMPORT"] }),
      Response.json(call.response),
      Response.json({ permissions: [] }),
    );

    const client = await connect(fetcher);
    const params = { name: call.name, arguments: call.arguments };

    expect((await client.callTool(params)).isError).not.toBe(true);
    const revoked = await client.callTool(params);

    expect(revoked.isError).toBe(true);
    expect(JSON.stringify(revoked)).toContain("permission is missing");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(requestUrl(required(fetcher.mock.calls[2], "rechecked permissions request")[0])).toBe(
      permissionsUrl,
    );
  });

  it("reads IDs and an inclusive calendar range through their fixed paths", async () => {
    const fetcher = responses(
      Response.json({ permissions: ["WORKOUT_IMPORT"] }),
      Response.json(publishedWorkout),
      Response.json({ permissions: ["WORKOUT_IMPORT"] }),
      Response.json(publishedSchedule),
      Response.json({ permissions: ["WORKOUT_IMPORT"] }),
      Response.json([publishedSchedule]),
    );

    const client = await connect(fetcher);

    const gotWorkout = await client.callTool({
      name: "get_workout",
      arguments: { workoutId: 871 },
    });

    const gotSchedule = await client.callTool({
      name: "get_workout_schedule",
      arguments: { scheduleId: 472 },
    });

    const gotSchedules = await client.callTool({
      name: "list_workout_schedules",
      arguments: { startDate: "2026-10-01", endDate: "2026-10-31" },
    });

    expect(gotWorkout.structuredContent).toEqual({
      source: "Garmin Connect",
      data: publishedWorkout,
    });
    expect(gotSchedule.structuredContent).toEqual({
      source: "Garmin Connect",
      data: publishedSchedule,
    });
    expect(gotSchedules.structuredContent).toEqual({
      source: "Garmin Connect",
      data: [publishedSchedule],
    });

    expect(
      fetcher.mock.calls.filter((_, index) => index % 2 === 1).map(([input]) => requestUrl(input)),
    ).toEqual([
      "https://apis.garmin.com/training-api/workout/v2/871",
      "https://apis.garmin.com/training-api/schedule/472",
      "https://apis.garmin.com/training-api/schedule?startDate=2026-10-01&endDate=2026-10-31",
    ]);
  });

  it.each([
    { name: "get_workout", arguments: { workoutId: "../schedule?x=1" } },
    { name: "get_workout", arguments: { workoutId: "871" } },
    { name: "get_workout", arguments: { workoutId: 0 } },
    { name: "get_workout", arguments: { workoutId: Number.MAX_SAFE_INTEGER + 1 } },
    { name: "get_workout_schedule", arguments: { scheduleId: -1 } },
    { name: "get_workout_schedule", arguments: { scheduleId: 1.5 } },
    { name: "schedule_workout", arguments: { ...schedule, date: "2026-02-30" } },
    { name: "schedule_workout", arguments: { ...schedule, date: "2026-10-25T00:00:00Z" } },
    { name: "schedule_workout", arguments: { ...schedule, date: "2026-10-25&workoutId=1" } },
    { name: "schedule_workout", arguments: { ...schedule, accessToken: privateValue } },
    {
      name: "list_workout_schedules",
      arguments: { startDate: "2026-10-25", endDate: "2026-10-01" },
    },
    {
      name: "list_workout_schedules",
      arguments: { startDate: "2026-10-01", endDate: "2026-11-01" },
    },
    {
      name: "create_workout",
      arguments: {
        workout: {
          ...workout,
          segments: [
            { segmentOrder: 1, sport: "RUNNING", steps: [{ ...activeStep, durationValue: 0 }] },
          ],
        },
      },
    },
    {
      name: "create_workout",
      arguments: {
        workout: {
          ...workout,
          segments: [
            {
              segmentOrder: 1,
              sport: "RUNNING",
              steps: [{ ...activeStep, targetType: "PACE", targetValueLow: 4, targetValueHigh: 3 }],
            },
          ],
        },
      },
    },
  ])("rejects invalid $name input before any outbound request: $arguments", async (params) => {
    const fetcher = responses();
    const client = await connect(fetcher);
    const result = await client.callTool(params);

    expect(result.isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["missing permission array", "malformed workout", "invalid schedule date"])(
    "sanitizes an upstream %s payload in both MCP output formats",
    async (scenario) => {
      const fetcher =
        scenario === "missing permission array"
          ? responses(Response.json({ permissions: privateValue }))
          : responses(
              Response.json({ permissions: ["WORKOUT_IMPORT"] }),
              Response.json(
                scenario === "malformed workout"
                  ? { ...publishedWorkout, workoutId: privateValue }
                  : { ...publishedSchedule, date: privateValue },
              ),
            );

      const client = await connect(fetcher);

      const result = await client.callTool(
        scenario === "invalid schedule date"
          ? { name: "schedule_workout", arguments: schedule }
          : { name: "create_workout", arguments: { workout } },
      );

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result)).toContain("unrecognized response");
      expect(JSON.stringify(result)).not.toContain(privateValue);
      expect(JSON.stringify(result)).not.toContain(accessToken);
      expect(fetcher).toHaveBeenCalledTimes(scenario === "missing permission array" ? 1 : 2);
    },
  );
});

describe("Training client request boundaries", () => {
  it("infers response types and retains harmless new Garmin fields", async () => {
    const data = { ...publishedSchedule, futureMetric: { count: 2 } };
    const client = new TrainingClient(accessToken, responses(Response.json(data)));
    const result = await client.getSchedule(scheduleResponse, 472);

    expectTypeOf(result.scheduleId).toEqualTypeOf<number>();
    expectTypeOf(result.date).toEqualTypeOf<string>();
    expect(result).toEqual(data);
  });

  it.each([
    { status: 401, message: "expired or was revoked" },
    { status: 403, message: "Workout Import permission" },
    { status: 412, message: "Workout Import permission" },
    { status: 429, message: "rate limit" },
    { status: 500, message: "HTTP 500" },
    { status: 302, message: "HTTP 302" },
  ])(
    "never retries a write after HTTP $status and discards the upstream body",
    async ({ status, message }) => {
      const cancel = vi.fn();

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(privateValue));
        },
        cancel,
      });

      const fetcher = responses(new Response(body, { status }));
      const client = new TrainingClient(accessToken, fetcher);
      const request = client.createWorkout(workoutResponse, workout);

      await expect(request).rejects.toBeInstanceOf(TrainingError);
      await expect(request).rejects.toMatchObject({ status });
      await expect(request).rejects.toThrow(message);
      await expect(request).rejects.not.toThrow(accessToken);
      await expect(request).rejects.not.toThrow(privateValue);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
      expect(required(fetcher.mock.calls[0], "failed outbound request")[1]?.redirect).toBe(
        "manual",
      );
    },
  );

  it("does not retry or disclose a network error after a write may have succeeded", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError(privateValue));
    const client = new TrainingClient(accessToken, fetcher);
    const request = client.scheduleWorkout(scheduleResponse, schedule);

    await expect(request).rejects.toMatchObject({ status: 502 });
    await expect(request).rejects.toThrow("write may have succeeded");
    await expect(request).rejects.not.toThrow(privateValue);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(["caller", "timeout"])(
    "aborts one outbound request on %s cancellation",
    async (source) => {
      const caller = new AbortController();
      const timeout = new AbortController();
      const deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);

      const fetcher = vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            required(init?.signal, "outbound cancellation signal").addEventListener(
              "abort",
              () => {
                reject(new DOMException(privateValue, "AbortError"));
              },
              { once: true },
            );
          }),
      );

      const client = new TrainingClient(accessToken, fetcher);
      const request = client.createWorkout(workoutResponse, workout, caller.signal);

      expect(deadline).toHaveBeenCalledWith(20_000);
      (source === "caller" ? caller : timeout).abort();

      await expect(request).rejects.toMatchObject({ status: source === "caller" ? 499 : 502 });
      await expect(request).rejects.toThrow(
        source === "caller" ? "cancelled" : "write may have succeeded",
      );
      await expect(request).rejects.not.toThrow(privateValue);
      expect(
        required(fetcher.mock.calls[0], "cancelled outbound request")[1]?.signal?.aborted,
      ).toBe(true);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("retains cancellation semantics if the response body aborts after headers arrive", async () => {
    const caller = new AbortController();
    let startReading: (() => void) | undefined;

    const reading = new Promise<void>((resolve) => {
      startReading = resolve;
    });

    const fetcher = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              required(init?.signal, "body cancellation signal").addEventListener(
                "abort",
                () => {
                  controller.error(new DOMException(privateValue, "AbortError"));
                },
                { once: true },
              );
            },
            pull() {
              required(startReading, "body reader notification")();
            },
          }),
        ),
      ),
    );

    const client = new TrainingClient(accessToken, fetcher);
    const request = client.getWorkout(workoutResponse, 871, caller.signal);

    await reading;
    caller.abort();

    await expect(request).rejects.toMatchObject({ status: 499 });
    await expect(request).rejects.toThrow("cancelled");
    await expect(request).rejects.not.toThrow(privateValue);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("keeps HTTP error mapping safe even when cancelling the discarded body fails", async () => {
    const cancel = vi.fn(() => Promise.reject(new Error(privateValue)));

    const fetcher = responses(
      new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 429 }),
    );

    const client = new TrainingClient(accessToken, fetcher);
    const request = client.createWorkout(workoutResponse, workout);

    await expect(request).rejects.toMatchObject({ status: 429 });
    await expect(request).rejects.toThrow("rate limit");
    await expect(request).rejects.not.toThrow(privateValue);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("cancels responses over 1 MiB and hides stream contents", async () => {
    const cancel = vi.fn();

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel,
    });

    const fetcher = responses(new Response(stream));
    const client = new TrainingClient(accessToken, fetcher);

    const request = client.getWorkout(workoutResponse, 871);

    await expect(request).rejects.toMatchObject({ status: 502 });
    await expect(request).rejects.toThrow("unrecognized response");
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "malformed JSON", body: `{${privateValue}` },
    { label: "invalid ID", body: JSON.stringify({ ...publishedWorkout, workoutId: privateValue }) },
    {
      label: "unsafe ID",
      body: JSON.stringify({ ...publishedWorkout, workoutId: Number.MAX_SAFE_INTEGER + 1 }),
    },
  ])("redacts $label validation failures", async ({ body }) => {
    const fetcher = responses(new Response(body));
    const client = new TrainingClient(accessToken, fetcher);
    const request = client.getWorkout(workoutResponse, 871);

    await expect(request).rejects.toThrow("unrecognized response");
    await expect(request).rejects.not.toThrow(privateValue);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("Training v2 contract regressions", () => {
  it("normalizes Garmin's numeric schedule ID without guessing a date or workout", async () => {
    const fetcher = responses(
      Response.json({ permissions: ["WORKOUT_IMPORT"] }),
      Response.json(472),
    );

    const client = await connect(fetcher);
    const result = await client.callTool({ name: "schedule_workout", arguments: schedule });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      source: "Garmin Connect",
      data: { scheduleId: 472 },
    });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(result.structuredContent) },
    ]);
    expect(scheduleWriteResponse.safeParse(0).success).toBe(false);
    expect(scheduleWriteResponse.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });

  it("constructs supported Workers Requests for data calls without following redirects", async () => {
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      const request = new Request(input, init);
      expect(request.redirect).toBe("manual");

      return Promise.resolve(Response.json(publishedSchedule));
    });

    const client = new TrainingClient(accessToken, fetcher);
    expect(await client.getSchedule(scheduleResponse, 472)).toEqual(publishedSchedule);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects legacy top-level steps and server-assigned create identifiers", () => {
    const segment = required(workout.segments[0], "fixture segment");
    expect(
      workoutInput.safeParse({ workoutName: "Legacy", sport: "RUNNING", steps: segment.steps })
        .success,
    ).toBe(false);
    expect(workoutInput.safeParse({ ...workout, workoutId: 871 }).success).toBe(false);
    expect(workoutInput.safeParse({ ...workout, ownerId: 52 }).success).toBe(false);
    expect(workoutInput.safeParse({ ...workout, workoutProvider: "x".repeat(21) }).success).toBe(
      false,
    );
  });

  it("validates multisport ordering, matching single-sport segments and the documented total step budgets", () => {
    const running = { segmentOrder: 1, sport: "RUNNING", steps: [activeStep] };
    const cycling = { segmentOrder: 2, sport: "CYCLING", steps: [{ ...activeStep, stepOrder: 2 }] };
    expect(
      workoutInput.safeParse({ ...workout, sport: "MULTI_SPORT", segments: [running, cycling] })
        .success,
    ).toBe(true);
    expect(workoutInput.safeParse({ ...workout, segments: [cycling] }).success).toBe(false);
    expect(
      workoutInput.safeParse({
        ...workout,
        sport: "MULTI_SPORT",
        segments: [running, { ...cycling, steps: [activeStep] }],
      }).success,
    ).toBe(false);

    const steps = Array.from({ length: 100 }, (_, index) => ({
      ...activeStep,
      stepOrder: index + 1,
    }));

    expect(workoutInput.safeParse({ ...workout, segments: [{ ...running, steps }] }).success).toBe(
      true,
    );
    const extra = { ...activeStep, stepOrder: 101 };
    expect(
      workoutInput.safeParse({
        ...workout,
        segments: [
          {
            ...running,
            steps: [
              ...steps.slice(0, 99),
              {
                type: "WorkoutRepeatStep",
                stepOrder: 100,
                repeatType: "REPEAT_UNTIL_STEPS_CMPLT",
                repeatValue: 2,
                steps: [extra],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);

    const segments = Array.from({ length: 3 }, (_, index) => ({
      ...running,
      segmentOrder: index + 1,
      steps: steps
        .slice(0, index === 2 ? 50 : 100)
        .map((step, offset) => ({ ...step, stepOrder: index * 100 + offset + 1 })),
    }));

    expect(workoutInput.safeParse({ ...workout, sport: "MULTI_SPORT", segments }).success).toBe(
      true,
    );

    const overBudget = segments.map((segment, index) =>
      index === 2
        ? { ...segment, steps: [...segment.steps, { ...activeStep, stepOrder: 250 }] }
        : segment,
    );

    expect(
      workoutInput.safeParse({ ...workout, sport: "MULTI_SPORT", segments: overBudget }).success,
    ).toBe(false);
  });

  it("supports unspecified swim pools and documented strokes without accepting running targets or mismatched multisport pools", () => {
    const swim = {
      segmentOrder: 1,
      sport: "LAP_SWIMMING",
      steps: [{ ...activeStep, targetType: "SWIM_STROKE", strokeType: "CHOICE" }],
    };

    expect(
      workoutInput.safeParse({
        workoutName: "Swim",
        sport: "LAP_SWIMMING",
        poolLength: null,
        poolLengthUnit: null,
        segments: [swim],
      }).success,
    ).toBe(true);
    expect(
      workoutInput.safeParse({
        workoutName: "Swim",
        sport: "LAP_SWIMMING",
        segments: [{ ...swim, steps: [activeStep] }],
      }).success,
    ).toBe(false);
    expect(
      workoutInput.safeParse({
        workoutName: "Triathlon",
        sport: "MULTI_SPORT",
        poolLength: 25,
        poolLengthUnit: "METER",
        segments: [{ ...swim, poolLength: 50, poolLengthUnit: "METER" }],
      }).success,
    ).toBe(false);
    expect(
      workoutStep.safeParse({ ...activeStep, targetType: "HEART_RATE", targetValue: 6 }).success,
    ).toBe(false);
    expect(
      workoutStep.safeParse({ ...activeStep, targetType: "POWER", targetValue: 8 }).success,
    ).toBe(false);
  });

  it.each([200, 204])(
    "accepts empty HTTP %s mutation successes without inventing identifiers and rejects empty reads",
    async (status) => {
      const fetcher = responses(...Array.from({ length: 6 }, () => new Response(null, { status })));

      const client = new TrainingClient(accessToken, fetcher);
      expect(await client.createWorkout(workoutWriteResponse, workout)).toEqual({ accepted: true });
      expect(await client.scheduleWorkout(scheduleWriteResponse, schedule)).toEqual({
        accepted: true,
      });
      expect(await client.updateWorkout(workoutWriteResponse, 871, 52, workout)).toEqual({
        accepted: true,
      });
      expect(await client.updateSchedule(scheduleWriteResponse, 472, schedule)).toEqual({
        accepted: true,
      });
      expect(await client.deleteWorkout(mutationAccepted, 871)).toEqual({ accepted: true });
      expect(await client.deleteSchedule(mutationAccepted, 472)).toEqual({ accepted: true });

      const readClient = new TrainingClient(
        accessToken,
        responses(new Response(null, { status: 204 })),
      );

      await expect(readClient.getWorkout(workoutResponse, 871)).rejects.toThrow(
        "unrecognized response",
      );
    },
  );
});

describe("Training schema boundaries", () => {
  it("accepts a common repeat block and preserves strength exercise, repetitions, and kilogram fields", () => {
    expect(createWorkoutInput.parse({ workout }).workout).toEqual({
      ...workout,
      workoutProvider: "Garmin MCP",
      workoutSourceId: "Garmin MCP",
    });

    const strength = {
      workoutName: "Test strength session",
      sport: "STRENGTH_TRAINING",
      segments: [
        {
          segmentOrder: 1,
          sport: "STRENGTH_TRAINING",
          steps: [
            {
              ...activeStep,
              durationType: "REPS",
              durationValue: 8,
              exerciseCategory: "SQUAT",
              exerciseName: "BARBELL_BACK_SQUAT",
              weightValue: 60,
              weightDisplayUnit: "POUND",
            },
          ],
        },
      ],
    };

    expect(workoutInput.parse(strength)).toMatchObject(strength);
    expect(
      workoutStep.parse({ ...activeStep, durationType: "OPEN", durationValue: undefined })
        .durationType,
    ).toBe("OPEN");
  });

  it.each([
    { durationType: "TIME", durationValue: undefined },
    { durationType: "DISTANCE", durationValue: -100 },
    { durationType: "OPEN", durationValue: 60 },
    { durationType: "REPS", durationValue: 2.5 },
    { targetType: "PACE", targetValueLow: 4, targetValueHigh: 3 },
    { targetType: "PACE", targetValueLow: 3 },
    { targetType: "PACE", targetValue: 3 },
    { targetType: "PACE", targetValueLow: 3, targetValueHigh: 4, targetValueType: "PERCENT" },
    { targetType: "OPEN", targetValueLow: 3, targetValueHigh: 4 },
    { targetType: "HEART_RATE", targetValue: 2, targetValueLow: 120, targetValueHigh: 140 },
    { weightValue: -1 },
    { weightDisplayUnit: "STONE" },
    { stepOrder: 251 },
  ])("rejects incompatible duration, target, or strength fields: %j", (fields) => {
    expect(workoutStep.safeParse({ ...activeStep, ...fields }).success).toBe(false);
  });

  it("enforces global step ordering and bounds repeat blocks", () => {
    const repeat = required(
      workout.segments[0]?.steps.find((step) => step.type === "WorkoutRepeatStep"),
      "repeat step",
    );

    for (const invalid of [
      { ...repeat, repeatValue: 1 },
      { ...repeat, repeatValue: 101 },
      { ...repeat, steps: [] },
      { ...repeat, steps: [{ ...activeStep, stepOrder: repeat.stepOrder }] },
      {
        ...repeat,
        steps: [
          { ...activeStep, stepOrder: 4 },
          { ...activeStep, stepOrder: 3 },
        ],
      },
    ]) {
      expect(
        workoutInput.safeParse({
          ...workout,
          segments: [{ segmentOrder: 1, sport: "RUNNING", steps: [invalid] }],
        }).success,
      ).toBe(false);
    }
  });

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Infinity,
    "871",
    "../schedule?x=1",
  ])("rejects invalid Training IDs: %j", (id) => {
    expect(trainingId.safeParse(id).success).toBe(false);
    expect(scheduleWorkoutInput.safeParse({ ...schedule, workoutId: id }).success).toBe(false);
  });

  it("accepts real leap dates and inclusive 31-day ranges without normalizing the Garmin date", () => {
    expect(scheduleWorkoutInput.parse({ ...schedule, date: "2028-02-29" }).date).toBe("2028-02-29");
    expect(listSchedulesInput.parse({ startDate: "2026-10-25", endDate: "2026-10-25" })).toEqual({
      startDate: "2026-10-25",
      endDate: "2026-10-25",
    });
    expect(
      listSchedulesInput.safeParse({ startDate: "2028-02-01", endDate: "2028-03-02" }).success,
    ).toBe(true);
    expect(
      listSchedulesInput.safeParse({ startDate: "2028-02-01", endDate: "2028-03-03" }).success,
    ).toBe(false);
    expect(scheduleWorkoutInput.safeParse({ ...schedule, date: "2026-02-29" }).success).toBe(false);
  });
});
