import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';

const base = process.argv[2] ?? 'https://garmin-mcp.aranlucas.workers.dev';
const get = (path, init) => fetch(new URL(path, base), { ...init, redirect: 'manual' });
const health = await get('/health');
assert.equal(health.status, 200);
assert.equal((await health.json()).status, 'ok');
const landing = await get('/');
assert.equal(landing.status, 200);
assert.match(await landing.text(), /Personal API key/);
const challenge = await get('/mcp', { method: 'POST' });
assert.equal(challenge.status, 401);
assert.match(challenge.headers.get('www-authenticate'), /resource_metadata=/);
const resource = await (await get('/.well-known/oauth-protected-resource/mcp')).json();
assert.equal(resource.resource, `${base}/mcp`);
const auth = await (await get('/.well-known/oauth-authorization-server')).json();
assert.deepEqual(auth.code_challenge_methods_supported, ['S256']);
assert.equal(auth.authorization_endpoint, `${base}/authorize`);
const registered = await get('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_name: 'Deployment smoke test', redirect_uris: ['http://localhost:9876/callback'],
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
assert.equal(registered.status, 201);
const registration = await registered.json();
const verifier = randomBytes(48).toString('base64url');
const params = new URLSearchParams({ client_id: registration.client_id, redirect_uri: 'http://localhost:9876/callback',
  response_type: 'code', scope: 'garmin:read offline_access', state: 'deployment-smoke', resource: `${base}/mcp`,
  code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
const consentUrl = `${base}/authorize?${params}`;
const consent = await get(consentUrl);
assert.equal(consent.status, 200);
assert.match(consent.headers.get('content-security-policy'), /frame-ancestors 'none'/);
const html = await consent.text();
assert.match(html, /Garmin Personal API key/);
assert.match(html, /localhost/);
const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
assert.ok(handle);
const denied = await get('/authorize', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded',
  Origin: base, Cookie: consent.headers.get('set-cookie').split(';')[0] },
  body: new URLSearchParams({ handle, decision: 'deny' }) });
assert.equal(denied.status, 302);
assert.equal(new URL(denied.headers.get('location')).searchParams.get('error'), 'access_denied');
console.log('PASS: live health, setup page, protected MCP, OAuth discovery, public client registration, browser-bound consent, and deny redirect.');
console.log('Garmin data reads require a real Personal API key entered through the consent screen.');
