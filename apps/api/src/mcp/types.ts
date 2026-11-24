import type { Gql } from './graphql';

// The minimal surface of the assembled Elysia app the MCP layer uses: in-process
// dispatch to /graphql. A structural type (not Elysia<...>) so a concrete app is
// assignable without hitting Elysia's invariant generics.
export interface McpApp {
  handle: (request: Request) => Promise<Response>;
}

// The JSON Schema an MCP client receives for a tool's arguments.
export interface McpInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

// One MCP tool: what the client sees, and what a call runs (GraphQL as the caller).
export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpInputSchema;
  // A read tool only queries; it is the only kind /mcp/readonly lists and runs.
  readOnly: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (gql: Gql, args: Record<string, any>) => Promise<unknown>;
}
