import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { GARMIN_BASE, GARMIN_TOKEN_PATH, GarminClient, obtainToken, readBounded } from '../src/garmin';
import { consentFormAction } from '../src/auth';
import { endpointPath, parameterSchema, validateDateRange } from '../src/mcp';
import { consentPage } from '../src/pages';

const base = env.PUBLIC_URL;
const apiKey = 'test-only-personal-api-key-never-real';
const verifier = 'v'.repeat(64);

async function dispatch(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(new URL(path, base), init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function startConsent() {
  const registration = await dispatch('/oauth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Test assistant', redirect_uris: ['http://localhost:9876/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  expect(registration.status).toBe(201);
  const { client_id: clientId } = await registration.json<{ client_id: string }>();
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: 'http://localhost:9876/callback',
    response_type: 'code', scope: 'garmin:read offline_access', state: 'test-state',
    resource: `${base}/mcp`, code_challenge: challenge, code_challenge_method: 'S256' });
  const consent = await dispatch(`/authorize?${params}`);
  expect(consent.status).toBe(200);
  expect(consent.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  // Browsers enforce form-action on the post-consent redirect, and send `Origin: null` under no-referrer.
  expect(consent.headers.get('content-security-policy')).toContain("form-action 'self' http://localhost:9876;");
  expect(consent.headers.get('referrer-policy')).toBe('same-origin');
  const body = await consent.text();
  const handle = body.match(/name="handle" value="([^"]+)"/)?.[1];
  expect(handle).toBeTruthy();
  const cookie = consent.headers.get('set-cookie')!.split(';')[0];
  return { clientId, handle: handle!, cookie };
}

async function approve(womensHealth = false) {
  const consent = await startConsent();
  const form = new URLSearchParams({ handle: consent.handle, apiKey, decision: 'approve' });
  if (womensHealth) form.set('womensHealth', 'yes');
  const response = await dispatch('/authorize', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base, Cookie: consent.cookie }, body: form });
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get('location')!);
  expect(location.searchParams.get('state')).toBe('test-state');
  return { ...consent, code: location.searchParams.get('code')!, form };
}

async function exchange(clientId: string, code: string, codeVerifier = verifier) {
  return dispatch('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code,
      redirect_uri: 'http://localhost:9876/callback', resource: `${base}/mcp`, code_verifier: codeVerifier }) });
}

const expectedFetches: { path: string; method: string; status: number; body: unknown; authorization?: string }[] = [];
function mockGarmin(path: string, method: string, body: unknown, status = 200, authorization?: string) {
  expectedFetches.push({ path, method, status, body, authorization });
}
beforeEach(() => {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const expected = expectedFetches.shift();
    if (!expected) throw new Error('Unexpected outbound fetch');
    expect(String(input)).toBe(GARMIN_BASE + expected.path);
    expect(init?.method ?? 'GET').toBe(expected.method);
    if (expected.authorization) expect(new Headers(init?.headers).get('authorization')).toBe(expected.authorization);
    return Response.json(expected.body, { status: expected.status });
  });
});
afterEach(() => { expect(expectedFetches.splice(0)).toEqual([]); vi.unstubAllGlobals(); });

describe('Cloudflare OAuth and MCP integration', () => {
  it('publishes discovery and challenges unauthenticated MCP access', async () => {
    const metadata = await dispatch('/.well-known/oauth-authorization-server');
    expect(metadata.status).toBe(200);
    const data = await metadata.json<Record<string, unknown>>();
    expect(data.code_challenge_methods_supported).toEqual(['S256']);
    expect(data.registration_endpoint).toBe(`${base}/oauth/register`);
    const response = await dispatch('/mcp', { method: 'POST' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
    expect(await (await dispatch('/.well-known/oauth-protected-resource/mcp')).json()).toMatchObject({ resource: `${base}/mcp` });
  });

  it('binds consent to its browser and rejects forged requests before contacting Garmin', async () => {
    const consent = await startConsent();
    const form = new URLSearchParams({ handle: consent.handle, apiKey, decision: 'approve' });
    const badOrigin = await dispatch('/authorize', { method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example', Cookie: consent.cookie }, body: form });
    expect(badOrigin.status).toBe(403);
    const missingCookie = await dispatch('/authorize', { method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Origin: base }, body: form });
    expect(missingCookie.status).toBe(400);
  });

  it('supports deny without a key and rejects unregistered redirects', async () => {
    const consent = await startConsent();
    const denied = await dispatch('/authorize', { method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Origin: base, Cookie: consent.cookie },
      body: new URLSearchParams({ handle: consent.handle, decision: 'deny' }) });
    expect(new URL(denied.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
    const invalid = await dispatch(`/authorize?client_id=${encodeURIComponent(consent.clientId)}&redirect_uri=https://evil.example&response_type=code`);
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('location')).toBeNull();
  });

  it('authorizes, encrypts the key, serves real SDK calls, refreshes, and revokes', async () => {
    mockGarmin(GARMIN_TOKEN_PATH, 'POST', { access_token: 'mock-garmin-access' }, 200, `ApiKey ${apiKey}`);
    mockGarmin(GARMIN_TOKEN_PATH, 'POST', { access_token: 'mock-garmin-access' }, 200, `ApiKey ${apiKey}`);
    mockGarmin('/usersummary-service/usersummary/daily?calendarDate=2026-10-20', 'GET', { totalSteps: 1234 }, 200, 'Bearer mock-garmin-access');
    const approved = await approve();
    const tokensResponse = await exchange(approved.clientId, approved.code);
    expect(tokensResponse.status).toBe(200);
    const tokens = await tokensResponse.json<{ access_token: string; refresh_token: string }>();
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(JSON.stringify(tokens)).not.toContain(apiKey);
    const records = await env.OAUTH_KV.list();
    for (const record of records.keys) expect(await env.OAUTH_KV.get(record.name)).not.toContain(apiKey);
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      fetch: async (input, init) => {
        const req = new Request(input, init);
        return dispatch(req.url, { method: req.method, headers: req.headers, body: req.body });
      },
    });
    await client.connect(transport);
    const list = await client.listTools();
    expect(list.tools).toHaveLength(24);
    expect(list.tools.some(tool => tool.name === 'get_menstrual_summary')).toBe(false);
    const activities = list.tools.find(tool => tool.name === 'list_activities')!;
    expect(activities.inputSchema.required ?? []).not.toContain('startDate');
    expect(activities.inputSchema.properties?.search).toMatchObject({ description: expect.stringContaining('activity names') });
    expect(activities.description).not.toContain('31 days');
    const data = await client.callTool({ name: 'get_daily_summary', arguments: { calendarDate: '2026-10-20' } });
    expect(JSON.stringify(data)).toContain('1234');
    expect(JSON.stringify(data)).not.toContain('mock-garmin-access');
    const invalid = await client.callTool({ name: 'get_steps', arguments: { startDate: '2026-01-01', endDate: '2026-12-31' } });
    expect(invalid.isError).toBe(true);
    await client.close();
    const refresh = await dispatch('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: approved.clientId, refresh_token: tokens.refresh_token, resource: `${base}/mcp` }) });
    expect(refresh.status).toBe(200);
    const refreshed = await refresh.json<{ access_token: string; refresh_token: string }>();
    const discovery = await (await dispatch('/.well-known/oauth-authorization-server')).json<{ revocation_endpoint: string }>();
    const revoke = await dispatch(discovery.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: approved.clientId, token: refreshed.refresh_token, token_type_hint: 'refresh_token' }) });
    expect(revoke.status).toBe(200);
    expect((await dispatch('/mcp', { headers: { Authorization: `Bearer ${refreshed.access_token}` } })).status).toBe(401);
    expect((await exchange(approved.clientId, approved.code)).status).toBe(400);
  });

  it('requires explicit consent to expose women’s health tools and prevents consent replay', async () => {
    mockGarmin(GARMIN_TOKEN_PATH, 'POST', { accessToken: 'mock-access' });
    const approved = await approve(true);
    const tokens = await (await exchange(approved.clientId, approved.code)).json<{ access_token: string }>();
    const result = await dispatch('/mcp', { method: 'POST', headers: {
      Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    expect(await result.text()).toContain('get_menstrual_summary');
    const replay = await dispatch('/authorize', { method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Origin: base, Cookie: approved.cookie }, body: approved.form });
    expect(replay.status).toBe(400);
  });

  it('rejects a wrong PKCE verifier and an invalid Garmin key without saving a grant', async () => {
    mockGarmin(GARMIN_TOKEN_PATH, 'POST', { access_token: 'mock-access' });
    const approved = await approve();
    expect((await exchange(approved.clientId, approved.code, 'wrong'.repeat(16))).status).toBe(400);
    mockGarmin(GARMIN_TOKEN_PATH, 'POST', { sensitive: 'must not echo' }, 401);
    const consent = await startConsent();
    const response = await dispatch('/authorize', { method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Origin: base, Cookie: consent.cookie },
      body: new URLSearchParams({ handle: consent.handle, apiKey, decision: 'approve' }) });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('must not echo');
  });
});

describe('Garmin boundaries', () => {
  it('validates calendar dates, safe activity IDs, query limits and ordered date windows', () => {
    expect(parameterSchema({ name: 'date', in: 'query', schema: { type: 'string', format: 'date' } }).safeParse('2026-02-30').success).toBe(false);
    expect(parameterSchema({ name: 'activityId', in: 'path', required: true, schema: { type: 'integer' } }).safeParse(-1).success).toBe(false);
    expect(parameterSchema({ name: 'limit', in: 'query', schema: { type: 'integer' } }).safeParse(101).success).toBe(false);
    expect(() => validateDateRange({ fromDate: '2026-10-21', toDate: '2026-10-01' })).toThrow();
    expect(() => validateDateRange({ startDate: '2026-10-01', endDate: '2026-10-31' })).not.toThrow();
    expect(() => validateDateRange({ startDate: '2026-10-01', endDate: '2026-11-01' })).toThrow('31 calendar days');
    const optionalDate = parameterSchema({ name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } });
    expect(optionalDate.safeParse(undefined).success).toBe(true);
    expect(parameterSchema({ name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } }).safeParse(undefined).success).toBe(false);
    expect(endpointPath('/x/{id}', [{ name: 'id', in: 'path', schema: { type: 'string' } }, { name: 'search', in: 'query', schema: { type: 'string' } }],
      { id: 'a/b', search: 'a&b' })).toBe('/x/a%2Fb?search=a%26b');
  });
  it('bounds streamed responses and rejects malformed token payloads', async () => {
    await expect(readBounded(new Response('too large'), 3)).rejects.toThrow('too large');
    const mock: typeof fetch = async () => Response.json({ unrecognized: 'not a token' });
    await expect(obtainToken(apiKey, mock)).rejects.toThrow('unrecognized');
  });
  it('returns activity files as base64 and reuses one Garmin token per request', async () => {
    const calls: string[] = [];
    const mock: typeof fetch = async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input).slice(GARMIN_BASE.length)}`);
      if (String(input).endsWith(GARMIN_TOKEN_PATH)) return Response.json({ access_token: 'tok' });
      expect(new Headers(init?.headers).get('accept')).toBe('application/octet-stream');
      return new Response(new Uint8Array([0, 1, 2, 255]), { headers: { 'Content-Type': 'application/zip' } });
    };
    const client = new GarminClient(apiKey, mock);
    const file = { source: 'Garmin Connect', encoding: 'base64', contentType: 'application/zip', data: 'AAEC/w==' };
    expect(await client.get('/download-service/files/activity/1', true)).toEqual(file);
    expect(await client.get('/download-service/files/activity/2', true)).toEqual(file);
    expect(calls).toEqual([`POST ${GARMIN_TOKEN_PATH}`, 'GET /download-service/files/activity/1', 'GET /download-service/files/activity/2']);
  });
  it('maps upstream failures to safe messages without echoing bodies', async () => {
    const limited: typeof fetch = async () => new Response('secret body', { status: 429 });
    await expect(obtainToken(apiKey, limited)).rejects.toThrow('rate limit');
    const unreachable: typeof fetch = async () => { throw new TypeError('network down'); };
    await expect(obtainToken(apiKey, unreachable)).rejects.toThrow('could not be reached');
  });
  it('allows consent forms to redirect only to the validated client', () => {
    expect(consentFormAction('https://claude.ai/api/mcp/auth_callback?x=1')).toBe("'self' https://claude.ai");
    expect(consentFormAction('cursor://anysphere.cursor-mcp/oauth/callback')).toBe("'self' cursor:");
  });
  it('escapes untrusted OAuth client information', () => {
    const output = consentPage({ clientId: 'test', clientName: '<script>alert(1)</script>', redirectUri: 'https://example.org',
      redirectHost: 'example.org', redirectIsLoopback: false, scope: ['<script>'] }, 'handle');
    expect(output).not.toContain('<script>');
    expect(output).toContain('&#60;script&#62;');
  });
});
