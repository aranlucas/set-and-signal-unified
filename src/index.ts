import OAuthProvider, { insufficientScope, type OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { authHandler, READ_SCOPE, WOMENS_SCOPE, type AppEnv } from './auth';
import { createServer } from './mcp';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const publicUrl = new URL(env.PUBLIC_URL);
    if (new URL(request.url).origin !== publicUrl.origin) return new Response('Unknown host', { status: 421 });
    const provider = new OAuthProvider<AppEnv>({
      apiRoute: '/mcp', authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: [READ_SCOPE, WOMENS_SCOPE, 'offline_access'], requiredScopes: [READ_SCOPE],
      clientIdMetadataDocumentEnabled: true,
      accessTokenTTL: 3600, refreshTokenTTL: 30 * 24 * 3600,
      resourceMetadata: { resource: `${publicUrl.origin}/mcp`, authorization_servers: [publicUrl.origin], resource_name: 'Garmin Personal MCP' },
      defaultHandler: authHandler,
      apiHandler: {
        async fetch(req, _env, context) {
          if (new URL(req.url).pathname !== '/mcp') return new Response('Not found', { status: 404 });
          // OAuthProvider adds this documented context to its protected handler.
          const { props, auth } = context as OAuthResourceContext<unknown>;
          if (!auth.scope.includes(READ_SCOPE)) return insufficientScope(auth, [READ_SCOPE]);
          const candidate: unknown = props;
          if (!candidate || typeof candidate !== 'object' || !('apiKey' in candidate) || typeof candidate.apiKey !== 'string') {
            return Response.json({ error: 'invalid_token' }, { status: 401 });
          }
          const key = candidate.apiKey;
          // SDK v2 serves current per-request MCP and stateless 2025 clients.
          const handler = createMcpHandler(() => createServer(key, auth.scope), { maxRequestBodySize: 64 * 1024 });
          return handler.fetch(req);
        },
      },
    });
    try {
      return await provider.fetch(request, env as AppEnv, ctx);
    } catch {
      // Avoid logging upstream responses, authorization URLs, or credential-bearing headers.
      console.error(JSON.stringify({ event: 'request_failed', path: new URL(request.url).pathname }));
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
