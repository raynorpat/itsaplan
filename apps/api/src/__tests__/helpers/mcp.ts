import { expect } from 'bun:test';
import { app } from '../../app';

// Calls the MCP endpoint (Streamable HTTP, JSON-RPC) in process, as an MCP client
// does: the credential (an API key or OAuth token) as `Authorization: Bearer`.

export interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

export interface McpResponse {
  status: number;
  headers: Headers;
  result?: unknown;
  error?: unknown;
}

export async function mcp(
  token: string | null,
  method: string,
  params: Record<string, unknown> = {},
  path = '/mcp',
): Promise<McpResponse> {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  });
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  const text = await res.text();
  if (res.status !== 200) return { status: res.status, headers: res.headers };
  // The transport answers as JSON or as one server-sent event.
  const json = text.trim().startsWith('{')
    ? text
    : text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5))
        .join('');
  const message = JSON.parse(json) as { result?: unknown; error?: unknown };
  return { status: res.status, headers: res.headers, ...message };
}

export async function toolNames(token: string, path = '/mcp'): Promise<string[]> {
  const res = await mcp(token, 'tools/list', {}, path);
  expect(res.status).toBe(200);
  return (res.result as { tools: { name: string }[] }).tools.map((t) => t.name).sort();
}

export async function callTool(
  token: string,
  name: string,
  args: Record<string, unknown> = {},
  path = '/mcp',
): Promise<ToolResult> {
  const res = await mcp(token, 'tools/call', { name, arguments: args }, path);
  expect(res.status).toBe(200);
  return res.result as ToolResult;
}

// A tool call that must succeed; returns its JSON result.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function toolJson<T = any>(
  token: string,
  name: string,
  args: Record<string, unknown> = {},
  path = '/mcp',
): Promise<T> {
  const result = await callTool(token, name, args, path);
  if (result.isError) throw new Error(`${name} failed: ${result.content[0]?.text}`);
  return JSON.parse(result.content[0]!.text) as T;
}
