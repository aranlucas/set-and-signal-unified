import {
  Client,
  InMemoryTransport,
  type CallToolRequestParams,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, expectTypeOf, it, onTestFinished, vi } from "vitest";
import * as z from "zod";
import {
  exchangeTrainingCode,
  refreshTrainingToken,
  TrainingClient,
  TrainingError,
} from "../src/training/client";
import { createTrainingServer } from "../src/training/mcp";
import {
  createWorkoutInput,
  listSchedulesInput,
  scheduleResponse,
  scheduleWorkoutInput,
  trainingId,
  workoutInput,
  workoutResponse,
  workoutStep,
  type WorkoutInput,
} from "../src/training/schemas";
import { requestUrl, required } from "./support";

const accessToken = "fake-training-access-token-test-only";

const privateValue = "fake-private-upstream-value-test-only";

const permissionsUrl = "https://apis.garmin.com/wellness-api/rest/user/permissions";

const tokenUrl = "https://diauth.garmin.com/di-oauth2-service/oauth/token";

const credentials = {
  clientId: "fake-training-client-id-test-only",
  clientSecret: "fake-training-client-secret-test-only",
};

// These are mocked adapter fixtures; live Garmin portal schema validation is separate.
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
} satisfies WorkoutInput;

const publishedWorkout = { ...workout, workoutId: 871 };

const schedule = { workoutId: publishedWorkout.workoutId, date: "2026-10-25" };

const publishedSchedule = { ...schedule, scheduleId: 472 };

const tokenPayload = {
  access_token: accessToken,
  refresh_token: "fake-training-refresh-token-test-only",
  token_type: "Bearer",
  expires_in: 3600,
  refresh_token_expires_in: 7_776_000,
};

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Training MCP protocol", () => {
  it("lists exactly five separate tools with write and read annotations", async () => {
    const fetcher = responses();
    const client = await connect(fetcher);
    const list = await client.listTools();

    expect(list.tools.map((tool) => tool.name).toSorted()).toEqual(
      toolCalls.map((tool) => tool.name).toSorted(),
    );

    for (const tool of list.tools) {
      const write = ["create_workout", "schedule_workout"].includes(tool.name);

      expect(tool.annotations, tool.name).toEqual({
        readOnlyHint: !write,
        destructiveHint: false,
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
      Response.json(["WORKOUT_IMPORT"]),
      Response.json(publishedWorkout),
      Response.json(["WORKOUT_IMPORT"]),
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
        url: "https://apis.garmin.com/training-api/workout",
        method: "POST",
        body: JSON.stringify(workout),
      },
      { url: permissionsUrl, method: "GET", body: undefined },
      {
        url: "https://apis.garmin.com/training-api/schedule",
        method: "POST",
        body: JSON.stringify(schedule),
      },
    ]);

    for (const [, init] of fetcher.mock.calls) {
      const headers = new Headers(init?.headers);

      expect(headers.get("Authorization")).toBe(`Bearer ${accessToken}`);
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("Content-Type")).toBe(init?.method === "POST" ? "application/json" : null);
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([
    { name: "create_workout", arguments: { workout } },
    { name: "schedule_workout", arguments: schedule },
  ])("makes no $name write request when Workout Import permission is absent", async (call) => {
    const fetcher = responses(Response.json(["ACTIVITY_EXPORT"]));
    const client = await connect(fetcher);
    const result = await client.callTool(call);

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("Workout Import permission is missing");
    expect(result.structuredContent).toBeUndefined();
    expect(fetcher.mock.calls.map(([input]) => requestUrl(input))).toEqual([permissionsUrl]);
  });

  it.each(toolCalls)("checks permission again after revocation for $name", async (call) => {
    const fetcher = responses(
      Response.json(["WORKOUT_IMPORT"]),
      Response.json(call.response),
      Response.json([]),
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
      Response.json(["WORKOUT_IMPORT"]),
      Response.json(publishedWorkout),
      Response.json(["WORKOUT_IMPORT"]),
      Response.json(publishedSchedule),
      Response.json(["WORKOUT_IMPORT"]),
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
      "https://apis.garmin.com/training-api/workout/871",
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
      arguments: { workout: { ...workout, steps: [{ ...activeStep, durationValue: 0 }] } },
    },
    {
      name: "create_workout",
      arguments: {
        workout: {
          ...workout,
          steps: [{ ...activeStep, targetType: "PACE", targetValueLow: 4, targetValueHigh: 3 }],
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
              Response.json(["WORKOUT_IMPORT"]),
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
      expect(required(fetcher.mock.calls[0], "failed outbound request")[1]?.redirect).toBe("error");
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

describe("Training upstream tokens", () => {
  it("exchanges PKCE form fields and maps expiry durations, then replaces both tokens on refresh", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const rotated = {
      ...tokenPayload,
      access_token: "fake-rotated-training-access-test-only",
      refresh_token: "fake-rotated-training-refresh-test-only",
      expires_in: 1800,
      refresh_token_expires_in: 86_400,
    };

    const fetcher = responses(Response.json(tokenPayload), Response.json(rotated));
    vi.stubGlobal("fetch", fetcher);
    const redirectUri = "https://mcp.example.test/training/callback";

    const tokens = await exchangeTrainingCode(
      credentials,
      "fake-code+a&b",
      "fake-pkce-verifier-test-only",
      redirectUri,
    );

    expect(tokens).toEqual({
      accessToken,
      refreshToken: tokenPayload.refresh_token,
      accessTokenExpiresAt: now + tokenPayload.expires_in * 1000,
      refreshTokenExpiresAt: now + tokenPayload.refresh_token_expires_in * 1000,
    });
    expect(await refreshTrainingToken(credentials, tokens.refreshToken)).toEqual({
      accessToken: rotated.access_token,
      refreshToken: rotated.refresh_token,
      accessTokenExpiresAt: now + rotated.expires_in * 1000,
      refreshTokenExpiresAt: now + rotated.refresh_token_expires_in * 1000,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    const forms = fetcher.mock.calls.map(([input, init]) => {
      expect(requestUrl(input)).toBe(tokenUrl);
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).get("Content-Type")).toBe(
        "application/x-www-form-urlencoded",
      );
      expect(new Headers(init?.headers).get("Authorization")).toBeNull();

      return Object.fromEntries(z.instanceof(URLSearchParams).parse(init?.body));
    });

    expect(forms).toEqual([
      {
        grant_type: "authorization_code",
        code: "fake-code+a&b",
        code_verifier: "fake-pkce-verifier-test-only",
        redirect_uri: redirectUri,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      },
      {
        grant_type: "refresh_token",
        refresh_token: tokenPayload.refresh_token,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      },
    ]);
  });

  it.each([
    { ...tokenPayload, access_token: "" },
    { ...tokenPayload, access_token: "fake header\r\ninjection" },
    { ...tokenPayload, access_token: "fake\u0000token" },
    { ...tokenPayload, access_token: "fake\u0100token" },
    { ...tokenPayload, refresh_token: "" },
    { ...tokenPayload, token_type: "MAC" },
    { ...tokenPayload, expires_in: -1 },
    { ...tokenPayload, expires_in: "3600" },
    { ...tokenPayload, refresh_token_expires_in: 0 },
  ])("rejects malformed token payloads without exposing credentials: %j", async (payload) => {
    const fetcher = responses(Response.json({ ...payload, privateValue }));
    vi.stubGlobal("fetch", fetcher);
    const request = refreshTrainingToken(credentials, tokenPayload.refresh_token);

    await expect(request).rejects.toThrow("unrecognized response");
    await expect(request).rejects.not.toThrow(privateValue);
    await expect(request).rejects.not.toThrow(credentials.clientSecret);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("cancels token responses over 64 KiB", async () => {
    const cancel = vi.fn();

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
      cancel,
    });

    const fetcher = responses(new Response(stream));
    vi.stubGlobal("fetch", fetcher);

    await expect(refreshTrainingToken(credentials, tokenPayload.refresh_token)).rejects.toThrow(
      "unrecognized response",
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("Training schema boundaries", () => {
  it("accepts a common repeat block and preserves strength exercise, repetitions, and kilogram fields", () => {
    expect(createWorkoutInput.parse({ workout })).toEqual({ workout });

    const strength = {
      workoutName: "Test strength session",
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
    };

    expect(workoutInput.parse(strength)).toEqual(strength);
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
    { stepOrder: 201 },
  ])("rejects incompatible duration, target, or strength fields: %j", (fields) => {
    expect(workoutStep.safeParse({ ...activeStep, ...fields }).success).toBe(false);
  });

  it("enforces global step ordering and bounds repeat blocks", () => {
    const repeat = required(
      workout.steps.find((step) => step.type === "WorkoutRepeatStep"),
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
      expect(workoutInput.safeParse({ ...workout, steps: [invalid] }).success).toBe(false);
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
