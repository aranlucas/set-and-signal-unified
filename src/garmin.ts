import * as z from "zod";
import { GarminError } from "./garmin-error";

export const GARMIN_BASE = "https://personal.connectapi.garmin.com";

export const GARMIN_TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";

export async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  // Leaving the loop early cancels the stream.
  for await (const chunk of response.body) {
    if (!(chunk instanceof Uint8Array)) {
      throw new GarminError("Garmin returned an unreadable response.", 502);
    }

    total += chunk.byteLength;

    if (total > maxBytes) {
      throw new GarminError(
        "Garmin response is too large. Narrow the date range or activity limit.",
        413,
      );
    }

    chunks.push(chunk);
  }

  const result = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

async function checkedFetch(
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<Response> {
  let response: Response;

  try {
    response = await fetcher(GARMIN_BASE + path, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(init.signal ? [init.signal] : [])]),
    });
  } catch {
    if (init.signal?.aborted) {
      throw new GarminError("The Garmin request was cancelled.", 499);
    }

    throw new GarminError("Garmin could not be reached. Try again shortly.", 502);
  }

  if (!response.ok) {
    await response.body?.cancel();

    const message =
      response.status === 401 || response.status === 403
        ? "Garmin rejected this credential or permission. Check your Personal API key in Garmin Connect and reconnect."
        : response.status === 429
          ? "Garmin rate limit reached. Wait before retrying."
          : `Garmin returned HTTP ${response.status}. Try a smaller query or retry later.`;

    throw new GarminError(message, response.status);
  }

  return response;
}

const headerToken = z.string().min(1).regex(/^\S+$/);

const tokenResponse = z.union([
  z.object({ access_token: headerToken }).transform((data) => data.access_token),
  z.object({ accessToken: headerToken }).transform((data) => data.accessToken),
]);

const garminJson = z.json();

export type GarminJson = z.infer<typeof garminJson>;

export const garminFileSchema = z.strictObject({
  source: z.literal("Garmin Connect"),
  encoding: z.literal("base64"),
  contentType: z.string(),
  data: z.string(),
});

export type GarminFile = z.infer<typeof garminFileSchema>;

/** Schema-first fetching, following zod-fetch's API, with Garmin's bounded response handling. */
async function fetchJson<Output>(
  schema: z.ZodType<Output>,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
  maxBytes = 1024 * 1024,
): Promise<Output> {
  const response = await checkedFetch(path, init, fetcher);
  const bytes = await readBounded(response, maxBytes);
  const data: unknown = JSON.parse(new TextDecoder().decode(bytes));

  return schema.parse(data);
}

export async function obtainToken(
  apiKey: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  try {
    return await fetchJson(
      tokenResponse,
      GARMIN_TOKEN_PATH,
      {
        method: "POST",
        headers: { Authorization: `ApiKey ${apiKey}`, Accept: "application/json" },
        signal: signal ?? null,
      },
      fetcher,
      64 * 1024,
    );
  } catch (error) {
    if (error instanceof GarminError) {
      throw error;
    }

    throw new GarminError(
      "Garmin returned an unrecognized token response. No credential was saved.",
      502,
    );
  }
}

/** Request-local instance. No credentials, tokens, or health data in global state. */
export class GarminClient {
  private token?: Promise<string>;

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async headers(accept: string, signal?: AbortSignal): Promise<HeadersInit> {
    this.token ??= obtainToken(this.apiKey, this.fetcher, signal);

    return { Authorization: `Bearer ${await this.token}`, Accept: accept };
  }

  async get<Output>(
    schema: z.ZodType<Output>,
    path: string,
    signal?: AbortSignal,
  ): Promise<Output> {
    try {
      return await fetchJson(
        schema,
        path,
        { headers: await this.headers("application/json", signal), signal: signal ?? null },
        this.fetcher,
      );
    } catch (error) {
      if (error instanceof GarminError) {
        throw error;
      }

      // Zod issues can include personal data; only this fixed message may leave the boundary.
      throw new GarminError(
        "Garmin returned a response that does not match its published API schema.",
        502,
      );
    }
  }

  async download(path: string, signal?: AbortSignal): Promise<GarminFile> {
    const response = await checkedFetch(
      path,
      { headers: await this.headers("application/octet-stream", signal), signal: signal ?? null },
      this.fetcher,
    );

    const bytes = await readBounded(response, 2 * 1024 * 1024);

    return {
      source: "Garmin Connect",
      encoding: "base64",
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      data: Buffer.from(bytes).toString("base64"),
    };
  }
}
