import { auth, getActiveSession, trustedOrigins, signInOptions } from '@repo/auth';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { Elysia } from 'elysia';
import { planner } from './planner';
import { mountGraphql } from './graphql/mount';
import { mountMcp } from './mcp/mount';
import { internalNotificationRoutes } from './notifications/internal-routes';
import { internalWebhookRoutes } from './webhooks/internal-routes';
import { internalCycleRoutes } from './cycles/internal-routes';
import { internalUploadRoutes } from './uploads/routes';
import { registerInstanceHandlers } from './instance/handlers';

// The assembled Elysia app, without `.listen()`. `index.ts` imports this and
// binds the port; tests import it and pass it to Eden Treaty to drive routes in
// memory (no network). Keep the chain unbroken so `type App` stays accurate.
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
  // OpenAPI docs. Mounted on the main app (outside the planner's session guard)
  // so the UI at /docs and the spec at /docs/json are reachable without a
  // session. The spec is generated from the `t` schemas on every route.
  .use(
    swagger({
      path: '/docs',
      // Render with Scalar's own "default" theme to match the better-auth reference
      // at /api/auth/reference. `customCss: ""` drops the gradient theme that
      // @elysiajs/swagger injects by default (it falls back to elysiajsTheme only
      // when customCss is null/undefined).
      scalarConfig: {
        theme: 'default',
        customCss: '',
      },
      documentation: {
        info: {
          title: "It's a Plan API",
          version: '1.0.0',
          description: 'REST API for teams, issues, and their dependent entities.\n\n',
        },
        tags: [
          { name: 'Teams', description: 'Teams and the full work items view' },
          { name: 'Members', description: 'Team membership and team owners' },
          { name: 'Invites', description: 'Workspace invites (create, list, revoke)' },
          { name: 'Workspace', description: 'Workspace users: roles and suspension' },
          { name: 'Organization', description: 'Workspace settings (Linear Organization)' },
          { name: 'States', description: 'Workflow states and their order' },
          { name: 'Labels', description: 'Labels and label groups' },
          { name: 'Issues', description: 'Issues, their feed, and comments' },
          {
            name: 'Projects',
            description: 'Projects across teams, their statuses and activity feed',
          },
          { name: 'Project labels', description: 'Workspace-level project labels' },
          { name: 'Attachments', description: 'Issue attachments and raw bytes' },
          { name: 'Avatars', description: "Current user's avatar image (upload and raw bytes)" },
          { name: 'Uploads', description: 'Signed file upload URLs and uploaded file bytes' },
          { name: 'Views', description: 'Saved work items views' },
          { name: 'Webhooks', description: 'Outgoing webhook subscriptions' },
          { name: 'Notifications', description: "The session user's inbox notifications" },
        ],
        // Planner routes are session-gated. Besides the session cookie (sent by the
        // browser, not modelled here), a request may carry an `x-api-key` header:
        // better-auth's apiKey plugin resolves it to the owner's session
        // (enableSessionForAPIKeys). Declaring it here lets the Scalar UI at /docs
        // authorize with a key and call the planner routes.
        components: {
          securitySchemes: {
            apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
          },
        },
        security: [{ apiKey: [] }],
      },
    }),
  )
  // better-auth: forward every /api/auth/* request to its handler.
  .all('/api/auth/*', ({ request }) => auth.handler(request))
  // Example protected handler: read the session from better-auth.
  .get('/me', async ({ request }) => {
    const session = await getActiveSession(request.headers);
    if (!session) return { authenticated: false };
    return { authenticated: true, user: session.user };
  })
  // What the sign-in screen needs before there is a session (public; see
  // signInOptions in @repo/auth). Also served at /api/auth/instance/sign-in-options.
  .get('/auth-config', () => signInOptions())
  // Root doubles as the liveness/health endpoint.
  .get('/', () => ({ name: "It's a Plan api", status: 'ok' }))
  .use(internalNotificationRoutes)
  .use(internalWebhookRoutes)
  .use(internalCycleRoutes)
  .use(internalUploadRoutes)
  // Planner API: teams, issues, and their dependent entities.
  .use(planner);

// MCP endpoint (POST /mcp). Added after the chain so `type App` (the Eden client
// type) stays the REST surface; the MCP endpoint is JSON-RPC, not called via Eden.
// Its tools are generated from the planner routes tagged with mcpTool().
mountMcp(app);

// Linear-compatible GraphQL endpoint (/graphql), mounted the same way as MCP.
mountGraphql(app);

// App type — useful for Eden Treaty (type-safe client) on the frontend and in tests.
export type App = typeof app;
