import { Kind, parse, type DocumentNode, type OperationDefinitionNode } from 'graphql';

// The only GraphQL request answered without credentials: a query whose root fields
// are all `organizationInviteDetails` (or `__typename`), so the invite page works
// before the invitee has an account. Anything else — another root field in the same
// request, a fragment spread at the root, a mutation, a batch — needs a login.

const ANONYMOUS_FIELDS = new Set(['organizationInviteDetails', '__typename']);

interface GraphQLParams {
  query?: unknown;
  operationName?: unknown;
}

async function readParams(request: Request): Promise<GraphQLParams | null> {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    return {
      query: url.searchParams.get('query'),
      operationName: url.searchParams.get('operationName'),
    };
  }
  if (request.method !== 'POST') return null;
  try {
    const body = await request.clone().json();
    // A batch (array) is never anonymous.
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as GraphQLParams)
      : null;
  } catch {
    return null;
  }
}

function pickOperation(doc: DocumentNode, name: unknown): OperationDefinitionNode | null {
  const operations = doc.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );
  if (typeof name === 'string' && name)
    return operations.find((o) => o.name?.value === name) ?? null;
  return operations.length === 1 ? operations[0]! : null;
}

export async function isAnonymousRequest(request: Request): Promise<boolean> {
  const params = await readParams(request);
  if (!params || typeof params.query !== 'string') return false;
  let doc: DocumentNode;
  try {
    doc = parse(params.query);
  } catch {
    return false;
  }
  const operation = pickOperation(doc, params.operationName);
  if (!operation || operation.operation !== 'query') return false;
  const selections = operation.selectionSet.selections;
  let asksForInvite = false;
  for (const s of selections) {
    if (s.kind !== Kind.FIELD || !ANONYMOUS_FIELDS.has(s.name.value)) return false;
    if (s.name.value === 'organizationInviteDetails') asksForInvite = true;
  }
  return asksForInvite;
}
