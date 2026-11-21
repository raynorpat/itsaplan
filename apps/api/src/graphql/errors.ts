import { GraphQLError } from 'graphql';
import { HttpError } from '../shared/lib';

// Error codes in Linear's GraphQL `extensions.code` vocabulary.
export type GqlErrorCode =
  | 'AUTHENTICATION_ERROR'
  | 'FORBIDDEN'
  | 'ENTITY_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'NOT_IMPLEMENTED';

// HTTP status set on the response when the error ends the request (Yoga reads
// extensions.http). Only authentication changes the status; the rest are 200 with
// an `errors` entry, as in Linear.
const HTTP_STATUS: Partial<Record<GqlErrorCode, number>> = { AUTHENTICATION_ERROR: 401 };

export function gqlError(code: GqlErrorCode, message: string): GraphQLError {
  const status = HTTP_STATUS[code];
  return new GraphQLError(message, {
    extensions: {
      code,
      userPresentableMessage: message,
      ...(status ? { http: { status } } : {}),
    },
  });
}

const CODE_BY_STATUS: Record<number, GqlErrorCode> = {
  400: 'INVALID_INPUT',
  401: 'AUTHENTICATION_ERROR',
  403: 'FORBIDDEN',
  404: 'ENTITY_NOT_FOUND',
  409: 'CONFLICT',
};

// Turns a store HttpError into the matching GraphQL error. Anything else is
// rethrown unchanged, so Yoga masks it as an internal error.
export function fromHttpError(err: unknown): never {
  if (err instanceof HttpError && CODE_BY_STATUS[err.status])
    throw gqlError(CODE_BY_STATUS[err.status], err.message);
  throw err;
}
