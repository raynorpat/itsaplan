import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { graphqlAs, ToolError } from './graphql';
import { SERVER_INSTRUCTIONS } from './instructions';
import { commentTools } from './tools/comments';
import { issueTools } from './tools/issues';
import { projectTools } from './tools/projects';
import { workspaceTools } from './tools/workspace';
import type { McpApp, McpTool } from './types';

// Linear's MCP tool set. Every tool runs GraphQL as the caller, so access and scopes
// are GraphQL's own (an OAuth token without `write` is refused a write tool there).
export const TOOLS: McpTool[] = [
  ...issueTools,
  ...commentTools,
  ...projectTools,
  ...workspaceTools,
];

// A low-level MCP Server for one request. `readOnly` is the /mcp/readonly endpoint:
// it lists and runs only the read tools.
export function buildMcpServer(app: McpApp, credential: string, readOnly: boolean): Server {
  const server = new Server(
    // `name` is the stable programmatic identifier; `title` the display name.
    { name: 'itsaplan', title: 'Itsaplan', version: '1.0.0' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  const tools = TOOLS.filter((t) => !readOnly || t.readOnly);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const gql = graphqlAs(app, credential);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.readOnly
        ? { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        : {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
          },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName.get(req.params.name);
    if (!tool) {
      const text = TOOLS.some((t) => t.name === req.params.name)
        ? `${req.params.name} changes data and is not available on the read-only endpoint`
        : `Unknown tool: ${req.params.name}`;
      return { content: [{ type: 'text', text }], isError: true };
    }
    try {
      const result = await tool.run(gql, req.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      if (err instanceof ToolError)
        return { content: [{ type: 'text', text: err.message }], isError: true };
      throw err;
    }
  });

  return server;
}
