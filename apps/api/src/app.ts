import {
  auth,
  getActiveSession,
  trustedOrigins,
  hasConfiguredEmailProvider,
  hasConfiguredGoogle,
  isAuthServiceAllowed,
} from '@repo/auth';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { Elysia } from 'elysia';
import { planner } from './planner';
import { mountGraphql } from './graphql/mount';
import { mountMcp } from './mcp/mount';
import { internalNotificationRoutes } from './notifications/internal-routes';
import { internalWebhookRoutes } from './webhooks/internal-routes';
import { internalCycleRoutes } from './cycles/internal-routes';

// The assembled Elysia app, without `.listen()`. `index.ts` imports this and
// binds the port; tests import it and pass it to Eden Treaty to drive routes in
// memory (no network). Keep the chain unbroken so `type App` stays accurate.
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
          { name: 'Views', description: 'Saved work items views' },
          { name: 'Webhooks', description: 'Outgoing webhook subscriptions' },
          { name: 'Notifications', description: "The session user's inbox notifications" },
          {
            name: 'God',
            description:
              'Instance administration: registration policy, email provider, Google sign-in',
          },
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
  // What the sign-in and sign-up screens need before there is a session: whether
  // registration is open, invite-only, or closed, and which sign-in methods are
  // offered. Public on purpose — the screens are reached logged out. It carries no
  // credentials, only the instance's own policy.
  .get('/auth-config', async () => ({
    // People join by invite or an approved email domain; there is no open sign-up.
    registration: 'invite' as const,
    // The sign-in services the workspace allows (organization settings). An owner
    // may always use a magic link, so the sign-in page keeps the email field.
    // Without a mail provider the link is written to the API log.
    magicLink: true,
    requireEmailVerification: false,
    emailEnabled: await hasConfiguredEmailProvider(),
    google: (await hasConfiguredGoogle()) && (await isAuthServiceAllowed('google')),
    passkey: await isAuthServiceAllowed('passkey'),
  }))
  // Root doubles as the liveness/health endpoint.
  .get('/', () => ({ name: "It's a Plan api", status: 'ok' }))
  .use(internalNotificationRoutes)
  .use(internalWebhookRoutes)
  .use(internalCycleRoutes)
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
