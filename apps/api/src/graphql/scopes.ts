import { Kind, type DocumentNode, type OperationDefinitionNode } from 'graphql';
import type { Plugin } from 'graphql-yoga';
import type { OAuthScope } from '@repo/auth';
import type { RequestAuth } from '../shared/request-auth';
import { gqlError } from './errors';
import type { GraphQLContext } from './context';

// Linear's scopes for an OAuth token: a query needs `read` (`write` includes it); a
// mutation needs `write`, except the root fields a narrow scope allows on its own.
// Admin operations also need `admin`, which shared/access.ts applies to the role
// checks. Sessions and API keys are not limited.
const NARROW_MUTATIONS: Partial<Record<string, OAuthScope>> = {
  issueCreate: 'issues:create',
  attachmentCreate: 'issues:create',
  commentCreate: 'comments:create',
};

function rootFields(operation: OperationDefinitionNode): string[] {
  return operation.selectionSet.selections.flatMap((s) =>
    s.kind === Kind.FIELD ? [s.name.value] : [],
  );
}

function pickOperation(doc: DocumentNode, name?: string | null): OperationDefinitionNode | null {
  const operations = doc.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );
  if (name) return operations.find((o) => o.name?.value === name) ?? null;
  return operations.length === 1 ? operations[0]! : null;
}

// The scope the operation is missing, or null when the token's scopes allow it.
// A fragment spread at the root of a mutation needs `write` (it is not one of the
// narrow fields).
export function missingScope(
  auth: RequestAuth | null,
  doc: DocumentNode,
  operationName?: string | null,
): string | null {
  // No credentials: only the anonymous invite lookup gets here (anonymous.ts).
  if (!auth || auth.kind !== 'oauth') return null;
  const has = (scope: OAuthScope) => auth.scopes.includes(scope);
  const operation = pickOperation(doc, operationName);
  if (!operation) return null; // graphql-js reports the missing operation itself
  if (operation.operation !== 'mutation') return has('read') || has('write') ? null : 'read';
  if (has('write')) return null;
  const narrowOnly = operation.selectionSet.selections.every((s) => s.kind === Kind.FIELD);
  if (narrowOnly) {
    const fields = rootFields(operation);
    const allowed = fields.every((f) => f === '__typename' || has(NARROW_MUTATIONS[f]!));
    if (fields.length && allowed) return null;
  }
  return 'write';
}

// Refuses an operation the token's scopes do not allow, before it runs.
export const scopeCheck: Plugin<GraphQLContext> = {
  onExecute({ args, setResultAndStopExecution }) {
    const missing = missingScope(args.contextValue.auth, args.document, args.operationName);
    if (missing)
      setResultAndStopExecution({
        errors: [gqlError('FORBIDDEN', `Invalid scope: ${missing} required`)],
      });
  },
};
