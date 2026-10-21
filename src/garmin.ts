export const GARMIN_BASE = 'https://personal.connectapi.garmin.com';
export const GARMIN_TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

/** Only safe messages leave this boundary; upstream bodies can contain personal data. */
export class GarminError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new GarminError('Garmin response is too large. Narrow the date range or activity limit.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

async function checkedFetch(path: string, init: RequestInit, fetcher: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(GARMIN_BASE + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new GarminError('Garmin could not be reached. Try again shortly.', 502);
  }
  if (!response.ok) {
    await response.body?.cancel();
    const message = response.status === 401 || response.status === 403
      ? 'Garmin rejected this credential or permission. Check your Personal API key in Garmin Connect and reconnect.'
      : response.status === 429
        ? 'Garmin rate limit reached. Wait before retrying.'
        : `Garmin returned HTTP ${response.status}. Try a smaller query or retry later.`;
    throw new GarminError(message, response.status);
  }
  return response;
}

export async function obtainToken(apiKey: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await checkedFetch(GARMIN_TOKEN_PATH, {
    method: 'POST', headers: { Authorization: `ApiKey ${apiKey}`, Accept: 'application/json' },
  }, fetcher);
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode(await readBounded(response, 64 * 1024))); }
  catch (e) { if (e instanceof GarminError) throw e; throw new GarminError('Garmin returned an invalid token response.', 502); }
  if (!data || typeof data !== 'object') throw new GarminError('Garmin returned an invalid token response.', 502);
  const record = data as Record<string, unknown>;
  const token = record.access_token ?? record.accessToken;
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) {
    throw new GarminError('Garmin returned an unrecognized token response. No credential was saved.', 502);
  }
  return token;
}

/** Request-local instance. No credentials, tokens, or health data in global state. */
export class GarminClient {
  private token?: Promise<string>;
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}
  async get(path: string, binary = false): Promise<unknown> {
    this.token ??= obtainToken(this.apiKey, this.fetcher);
    const response = await checkedFetch(path, {
      headers: { Authorization: `Bearer ${await this.token}`, Accept: binary ? 'application/octet-stream' : 'application/json' },
    }, this.fetcher);
    const bytes = await readBounded(response, binary ? 2 * 1024 * 1024 : 1024 * 1024);
    if (binary) return {
      source: 'Garmin Connect', encoding: 'base64',
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      data: Buffer.from(bytes).toString('base64'),
    };
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new GarminError('Garmin returned invalid JSON.', 502); }
  }
}
