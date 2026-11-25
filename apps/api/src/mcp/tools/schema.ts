import type { McpInputSchema } from '../types';

// Small builders for the tools' argument schemas (JSON Schema).

export const str = (description: string) => ({ type: 'string', description });
export const int = (description: string, extra: Record<string, unknown> = {}) => ({
  type: 'integer',
  description,
  ...extra,
});
export const bool = (description: string) => ({ type: 'boolean', description });
export const strList = (description: string) => ({
  type: 'array',
  items: { type: 'string' },
  description,
});
// A string that may also be null, to clear the field.
export const nullableStr = (description: string) => ({ type: ['string', 'null'], description });
// An integer that may also be null, to clear the field.
export const nullableInt = (description: string) => ({ type: ['integer', 'null'], description });

export function object(
  properties: Record<string, unknown>,
  required: string[] = [],
): McpInputSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}

// The paging arguments of a list tool.
export const paging = {
  limit: int('How many to return (default 50, at most 250)', { minimum: 1, maximum: 250 }),
  cursor: str('The nextCursor of the previous page'),
};

export function pageArgs(args: { limit?: number; cursor?: string }) {
  return { first: Math.min(Math.max(args.limit ?? 50, 1), 250), after: args.cursor ?? null };
}

export function nextCursor(pageInfo: { hasNextPage: boolean; endCursor: string | null }) {
  return pageInfo.hasNextPage ? pageInfo.endCursor : null;
}

export const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';

interface PropertySchema {
  type?: string | string[];
  items?: { type?: string };
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
}

function describeType(type: string | string[], items?: { type?: string }): string {
  const one = (t: string) => {
    if (t === 'array') return `an array of ${items?.type ?? 'value'}s`;
    if (t === 'null') return 'null';
    return t === 'integer' ? 'an integer' : `a ${t}`;
  };
  return Array.isArray(type) ? type.map(one).join(' or ') : one(type);
}

function hasType(value: unknown, type: string, items?: { type?: string }): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return (
        Array.isArray(value) &&
        (!items?.type || value.every((item) => hasType(item, items.type!, undefined)))
      );
    default:
      return true;
  }
}

// Checks a call's arguments against the tool's input schema before it runs, since the
// MCP SDK does not; the message names the argument and what it must be.
export function checkArgs(schema: McpInputSchema, args: Record<string, unknown>): string | null {
  for (const name of schema.required ?? [])
    if (args[name] === undefined) return `${name} is required`;
  for (const [name, value] of Object.entries(args)) {
    const prop = schema.properties[name] as PropertySchema | undefined;
    if (!prop) {
      if (schema.additionalProperties === false) return `Unknown argument: ${name}`;
      continue;
    }
    if (value === undefined) continue;
    if (prop.type) {
      const types = Array.isArray(prop.type) ? prop.type : [prop.type];
      if (!types.some((t) => hasType(value, t, prop.items)))
        return `${name} must be ${describeType(prop.type, prop.items)}`;
    }
    if (prop.enum && !prop.enum.includes(value))
      return `${name} must be one of: ${prop.enum.join(', ')}`;
    if (typeof value === 'number') {
      if (prop.minimum !== undefined && value < prop.minimum)
        return `${name} must be at least ${prop.minimum}`;
      if (prop.maximum !== undefined && value > prop.maximum)
        return `${name} must be at most ${prop.maximum}`;
    }
  }
  return null;
}
