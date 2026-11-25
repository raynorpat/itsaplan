import { Kind, parse, type DocumentNode, type OperationDefinitionNode } from 'graphql';

// The requests answered without a user: a query whose root fields are all
// `organizationInviteDetails` (or `__typename`), so the invite page works before the
// invitee has an account; and, with a release pipeline access key, an operation whose
// root fields are all access key operations. Anything else — another root field in the
// same request, a fragment spread at the root, a batch — needs a login.

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

// The operation's kind and root field names, or null when the request is not one
// operation whose root holds only plain fields (a fragment spread or an inline fragment
// at the root, a batch, a body that does not parse).
async function rootFields(
  request: Request,
): Promise<{ operation: OperationDefinitionNode['operation']; fields: string[] } | null> {
  const params = await readParams(request);
  if (!params || typeof params.query !== 'string') return null;
  let doc: DocumentNode;
  try {
    doc = parse(params.query);
  } catch {
    return null;
  }
  const operation = pickOperation(doc, params.operationName);
  if (!operation) return null;
  const fields: string[] = [];
  for (const s of operation.selectionSet.selections) {
    if (s.kind !== Kind.FIELD) return null;
    fields.push(s.name.value);
  }
  return { operation: operation.operation, fields };
}

export async function isAnonymousRequest(request: Request): Promise<boolean> {
  const root = await rootFields(request);
  if (!root || root.operation !== 'query') return false;
  return (
    root.fields.every((f) => ANONYMOUS_FIELDS.has(f)) &&
    root.fields.includes('organizationInviteDetails')
  );
}

// The root fields a release pipeline access key may use (releases/keys.ts); a request
// with an access key and any other root field is refused before it runs.
export const ACCESS_KEY_FIELDS = new Set([
  'releaseSyncByAccessKey',
  'releaseUpdateByPipelineByAccessKey',
  'releaseCompleteByAccessKey',
  'latestReleaseByAccessKey',
  'recentReleasesByAccessKey',
  'releasePipelineByAccessKey',
]);

export async function isAccessKeyRequest(request: Request): Promise<boolean> {
  const root = await rootFields(request);
  if (!root || root.operation === 'subscription') return false;
  return (
    root.fields.some((f) => ACCESS_KEY_FIELDS.has(f)) &&
    root.fields.every((f) => f === '__typename' || ACCESS_KEY_FIELDS.has(f))
  );
}
