import { auth, trustedOrigins } from '@repo/auth';
import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { httpErrors } from './shared/http-errors';
import { uploadRoutes, internalUploadRoutes } from './uploads/routes';
import { avatarFileRoutes } from './avatars/routes';
import { attachmentFileRoutes } from './attachments/routes';
import { mountGraphql } from './graphql/mount';
import { mountMcp } from './mcp/mount';
import { mountOAuth } from './oauth/routes';
import { internalNotificationRoutes } from './notifications/internal-routes';
import { internalWebhookRoutes } from './webhooks/internal-routes';
import { internalCycleRoutes } from './cycles/internal-routes';
import { registerInstanceHandlers } from './instance/handlers';
// Registers the AgentSessionEvent webhook on the agent session events.
import './agents/webhook';
// Registers the workflow automation engine with the issues store.
import './workflows/engine';

// The assembled Elysia app, without `.listen()`. `index.ts` imports this and binds
// the port; tests import it and call `app.handle` in memory (no network).
//
// The data API is /graphql. Besides it the app serves better-auth (/api/auth/*), MCP,
// Linear's OAuth paths, the health check, the file routes (signed upload PUT and the
// public raw file GETs) and the worker's internal routes.
// The better-auth instance endpoints (/api/auth/instance/*) run the API's session and
// access rules through these handlers.
registerInstanceHandlers();

export const app = new Elysia()
  .use(
    cors({
      origin: trustedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Invite-Token'],
    }),
  )
  .use(httpErrors)
  // better-auth: forward every /api/auth/* request to its handler.
  .all('/api/auth/*', ({ request }) => auth.handler(request))
  // Root doubles as the liveness/health endpoint.
  .get('/', () => ({ name: "It's a Plan api", status: 'ok' }))
  .use(uploadRoutes)
  .use(avatarFileRoutes)
  .use(attachmentFileRoutes)
  .use(internalNotificationRoutes)
  .use(internalWebhookRoutes)
  .use(internalCycleRoutes)
  .use(internalUploadRoutes);

// MCP endpoints (POST /mcp, POST /mcp/readonly). Its tools run GraphQL in process as
// the caller (mcp/graphql.ts).
mountMcp(app);

// Linear-compatible GraphQL endpoint (/graphql), mounted the same way as MCP.
mountGraphql(app);

// Linear's OAuth paths (/oauth/*) and the server metadata, forwarded to better-auth's
// OAuth provider plugin.
mountOAuth(app);
