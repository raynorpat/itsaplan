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
