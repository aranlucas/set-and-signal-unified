import * as z from "zod";
import { readBounded } from "../garmin";
import { GarminError as TrainingError } from "../garmin-error";
import type { WorkoutInput, ScheduleInput } from "./schemas";

export const TRAINING_BASE = "https://apis.garmin.com";

// Pin the hostname in Garmin's later OAuth2PKCE_1.pdf; never follow credential-bearing redirects.
export const TRAINING_TOKEN_URL = "https://diauth.garmin.com/di-oauth2-service/oauth/token";

export { TrainingError };

type TrainingBody = WorkoutInput | ScheduleInput;

type UserIdentity = { userId: string };

const credential = z
  .string()
  .min(1)
  .max(16_384)
  .regex(/^[!-~]+$/);

export const tokenSet = z.object({
  accessToken: credential,
  refreshToken: credential,
  accessTokenExpiresAt: z.number().finite().positive(),
  refreshTokenExpiresAt: z.number().finite().positive(),
});

export type TokenSet = z.infer<typeof tokenSet>;

export type TrainingCredentials = { clientId: string; clientSecret: string };

const tokenResponse = z.object({
  access_token: credential,
  refresh_token: credential,
  token_type: z.string().regex(/^bearer$/i),
  expires_in: z
    .number()
    .int()
    .positive()
    .max(366 * 86_400),
  refresh_token_expires_in: z
    .number()
    .int()
    .positive()
    .max(366 * 86_400),
});

async function checkedFetch(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<Response> {
  let response: Response;

  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(init.signal ? [init.signal] : [])]),
    });
  } catch {
    throw new TrainingError(
      init.signal?.aborted
        ? "The Garmin Training request was cancelled."
        : "Garmin Training could not be reached. A write may have succeeded; check Garmin Connect before retrying.",
      init.signal?.aborted ? 499 : 502,
    );
  }

  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // A broken discard stream must not replace the safe HTTP error with upstream details.
    }

    const message =
      response.status === 401
        ? "Garmin Training access expired or was revoked. Refresh the MCP session or reconnect."
        : response.status === 403 || response.status === 412
          ? "Garmin requires Workout Import permission and an approved Training API application. Reconnect and allow workout access."
          : response.status === 429
            ? "Garmin Training rate limit reached. Wait before retrying."
            : `Garmin Training returned HTTP ${response.status}. Check Garmin Connect before retrying a write.`;

    throw new TrainingError(message, response.status);
  }

  return response;
}

async function validatedJson<Output>(
  schema: z.ZodType<Output>,
  response: Response,
  limit = 1024 * 1024,
  signal?: AbortSignal,
): Promise<Output> {
  try {
    const bytes = await readBounded(response, limit);
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));

    return schema.parse(data);
  } catch {
    if (signal?.aborted) {
      throw new TrainingError("The Garmin Training request was cancelled.", 499);
    }

    // Neither upstream data nor Zod issues may expose Garmin credentials or personal data.
    throw new TrainingError(
      "Garmin Training returned an unrecognized response. Check Garmin Connect before retrying a write.",
      502,
    );
  }
}

async function exchangeToken(
  config: TrainingCredentials,
  params: Record<string, string>,
): Promise<TokenSet> {
  const now = Date.now();

  const response = await checkedFetch(
    TRAINING_TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        ...params,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    },
    fetch,
  );

  const tokens = await validatedJson(tokenResponse, response, 64 * 1024);

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: now + tokens.expires_in * 1000,
    refreshTokenExpiresAt: now + tokens.refresh_token_expires_in * 1000,
  };
}

export function exchangeTrainingCode(
  config: TrainingCredentials,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<TokenSet> {
  return exchangeToken(config, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
}

export function refreshTrainingToken(
  config: TrainingCredentials,
  refreshToken: string,
): Promise<TokenSet> {
  return exchangeToken(config, { grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Request-local client; only fixed official Training API paths can be called. */
export class TrainingClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request<Output>(
    schema: z.ZodType<Output>,
    path: string,
    method: "GET" | "POST",
    signal?: AbortSignal,
    body?: TrainingBody,
  ): Promise<Output> {
    const headers = new Headers({
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "application/json",
    });

    const init: RequestInit = { method, headers, signal: signal ?? null };

    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(body);
    }

    const response = await checkedFetch(TRAINING_BASE + path, init, this.fetcher);

    return validatedJson(schema, response, 1024 * 1024, signal);
  }

  getUserId(signal?: AbortSignal): Promise<UserIdentity> {
    return this.request(
      z.object({ userId: z.string().min(1) }),
      "/wellness-api/rest/user/id",
      "GET",
      signal,
    );
  }

  getPermissions(signal?: AbortSignal): Promise<string[]> {
    return this.request(z.array(z.string()), "/wellness-api/rest/user/permissions", "GET", signal);
  }

  async requireWorkoutPermission(signal?: AbortSignal): Promise<void> {
    if (!(await this.getPermissions(signal)).includes("WORKOUT_IMPORT")) {
      throw new TrainingError(
        "Garmin Workout Import permission is missing. Reconnect and allow workout access.",
        403,
      );
    }
  }

  createWorkout<Output>(
    schema: z.ZodType<Output>,
    workout: WorkoutInput,
    signal?: AbortSignal,
  ): Promise<Output> {
    return this.request(schema, "/training-api/workout", "POST", signal, workout);
  }

  getWorkout<Output>(
    schema: z.ZodType<Output>,
    workoutId: number,
    signal?: AbortSignal,
  ): Promise<Output> {
    return this.request(schema, `/training-api/workout/${workoutId}`, "GET", signal);
  }

  scheduleWorkout<Output>(
    schema: z.ZodType<Output>,
    schedule: ScheduleInput,
    signal?: AbortSignal,
  ): Promise<Output> {
    return this.request(schema, "/training-api/schedule", "POST", signal, schedule);
  }

  getSchedule<Output>(
    schema: z.ZodType<Output>,
    scheduleId: number,
    signal?: AbortSignal,
  ): Promise<Output> {
    return this.request(schema, `/training-api/schedule/${scheduleId}`, "GET", signal);
  }

  listSchedules<Output>(
    schema: z.ZodType<Output>,
    startDate: string,
    endDate: string,
    signal?: AbortSignal,
  ): Promise<Output> {
    const query = new URLSearchParams({ startDate, endDate });

    return this.request(schema, `/training-api/schedule?${query}`, "GET", signal);
  }
}
