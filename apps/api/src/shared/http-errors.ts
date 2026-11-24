import { Elysia } from 'elysia';
import { HttpError, pgErrorCode, PG_INVALID_INPUT_CODES } from './lib';

// Error handling for the plain HTTP routes (health, file routes, internal routes).
// Errors are normalized to a { error } JSON body: HttpError carries its own status;
// a Postgres unique_violation becomes 409; request validation failures become 400;
// anything else is a 500 with the error logged. GraphQL, MCP and better-auth answer
// with their own error formats.
export const httpErrors = new Elysia({ name: 'http-errors' }).onError(
  { as: 'global' },
  ({ code, error, set }) => {
    if (error instanceof HttpError) {
      set.status = error.status;
      return { error: error.message };
    }
    if (code === 'VALIDATION') {
      set.status = 400;
      // The validator's first message is enough; the full report is large JSON.
      const first = (error as { all?: { summary?: string }[] }).all?.[0]?.summary;
      return { error: first ?? 'Invalid request' };
    }
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'Not found' };
    }
    if (pgErrorCode(error) === '23505') {
      set.status = 409;
      return { error: 'A record with this name already exists.' };
    }
    if (PG_INVALID_INPUT_CODES.has(pgErrorCode(error) ?? '')) {
      set.status = 400;
      return { error: 'Invalid input' };
    }
    console.error('[api] unhandled error:', error);
    set.status = 500;
    return { error: error instanceof Error ? error.message : 'Internal server error' };
  },
);
