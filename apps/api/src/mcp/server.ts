import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpApp, McpCaller } from './types';
import { routeTools, type McpRouteTool } from './generate';
import { dispatchTool } from './dispatch';
import { SERVER_INSTRUCTIONS } from './instructions';

// The scopes that let an OAuth token run a tool (Linear's rules for the operation the
// tool performs): reading needs `read`; creating an issue `issues:create` or `write`;
// adding a comment `comments:create` or `write`; any other write `write`. Admin tools
// need `admin` as well, which the routes' role checks apply (shared/access.ts).
export function toolScopes(tool: Pick<McpRouteTool, 'method' | 'path'>): string[] {
  if (tool.method === 'GET') return ['read'];
  if (tool.method === 'POST' && tool.path === '/teams/:teamKey/issues')
    return ['issues:create', 'write'];
  if (tool.method === 'POST' && tool.path === '/issues/:issueId/comments')
    return ['comments:create', 'write'];
  return ['write'];
}

// A low-level MCP Server for one request. tools/list returns every route tagged
// with x-mcp; tools/call dispatches to the real route via app.handle as the caller
// (an API key, or an OAuth token within its scopes). The low-level Server (not McpServer) is used so the route's
// TypeBox JSON Schema can be served as the tool inputSchema without converting to
// Zod. Arguments are validated by the route itself, not here.
export function buildMcpServer(app: McpApp, caller: McpCaller): Server {
  const server = new Server(
    // `name` is the stable programmatic identifier; `title` is the human-readable
    // display name a client shows to the user (per the MCP Implementation spec).
    { name: 'itsaplan', title: 'Itsaplan', version: '1.0.0' },
    // `instructions` reaches the client in the initialize response and covers what
    // no single tool description can: which tool resolves ids, how a column is
    // picked, how far a request to "work on an issue" goes.
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  const table = routeTools(app);
  const byName = new Map(table.map((t) => [t.name, t]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: table.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName.get(req.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
        isError: true,
      };
    }
    if (caller.kind === 'oauth') {
      const allowed = toolScopes(tool);
      if (!allowed.some((scope) => caller.auth.scopes.includes(scope as never)))
        return {
          content: [
            {
              type: 'text',
              text: `This tool needs the ${allowed.map((s) => `\`${s}\``).join(' or ')} scope`,
            },
          ],
          isError: true,
        };
    }
    const { text, isError } = await dispatchTool(app, tool, req.params.arguments ?? {}, caller);
    return { content: [{ type: 'text', text }], isError };
  });

  return server;
}
