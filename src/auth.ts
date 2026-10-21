import { AuthorizationError, CimdFetchError, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { GarminError, obtainToken, readBounded } from './garmin';
import { consentPage, escape, home, page, privacyPage } from './pages';

export type AppEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
export const READ_SCOPE = 'garmin:read';
export const WOMENS_SCOPE = 'garmin:womens-health';

export function html(body: string, status = 200, headers = new Headers(), formAction = "'self'"): Response {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; base-uri 'none'; frame-ancestors 'none'`);
  headers.set('X-Content-Type-Options', 'nosniff');
  // Not no-referrer: browsers then send `Origin: null` on form posts, failing the Origin check.
  headers.set('Referrer-Policy', 'same-origin');
  return new Response(body, { status, headers });
}

/** Browsers apply form-action to the redirect after a form post, so allow the validated client redirect. */
export function consentFormAction(redirectUri: string): string {
  const url = new URL(redirectUri);
  return `'self' ${url.origin === 'null' ? url.protocol : url.origin}`;
}

export const authHandler = {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return html(home(env.PUBLIC_URL));
    if (request.method === 'GET' && url.pathname === '/privacy') return html(privacyPage());
    if (url.pathname === '/health' && request.method === 'GET') return Response.json({ status: 'ok', service: 'garmin-personal-mcp' });
    if (url.pathname !== '/authorize') return new Response('Not found', { status: 404 });
    try {
      const oauth = env.OAUTH_PROVIDER;
      if (request.method === 'GET') {
        const authRequest = await oauth.parseAuthRequest(request);
        const details = await oauth.describeConsent(authRequest);
        const consent = await oauth.beginConsent(authRequest);
        return html(consentPage(details, consent.handle), 200, consent.headers, consentFormAction(details.redirectUri));
      }
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
      if (request.headers.get('Origin') !== new URL(env.PUBLIC_URL).origin) return new Response('Invalid origin', { status: 403 });
      if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return new Response('Expected a form', { status: 415 });
      const raw = await readBounded(new Response(request.body), 16 * 1024);
      const form = new URLSearchParams(new TextDecoder().decode(raw));
      const handle = form.get('handle') ?? '';
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle);
      const scopes = [READ_SCOPE];
      if (approved.request.scope.includes('offline_access')) scopes.push('offline_access');
      if (form.get('womensHealth') === 'yes') scopes.push(WOMENS_SCOPE);
      const apiKey = form.get('apiKey')?.trim() ?? '';
      if (apiKey.length < 8 || apiKey.length > 4096 || /\s/.test(apiKey)) {
        return html(page('Check your key', '<h1>Check your Personal API key.</h1><p>Enter the key generated in Garmin Connect, then start the connection again from your assistant.</p>'), 400, approved.headers);
      }
      // Verify before persisting the encrypted grant. Never save an unverified key.
      await obtainToken(apiKey);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
      const userId = Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request, userId, metadata: { source: 'Garmin Personal API' },
        scope: scopes, props: { apiKey },
      });
      approved.headers.set('Location', redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    } catch (error) {
      if (error instanceof AuthorizationError && request.method === 'GET' && error.redirectTo) return Response.redirect(error.redirectTo, 302);
      if (error instanceof AuthorizationError || error instanceof CimdFetchError || error instanceof GarminError) {
        const message = error instanceof GarminError ? error.message : 'This authorization request is invalid or expired. Start again from your assistant.';
        return html(page('Connection unsuccessful', `<h1>Connection unsuccessful.</h1><p>${escape(message)}</p><p>No new Garmin connection was saved. Start the connection again from your assistant.</p>`), error instanceof GarminError ? 502 : 400);
      }
      throw error;
    }
  },
};
