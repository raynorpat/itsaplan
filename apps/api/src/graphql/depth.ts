import {
  GraphQLError,
  Kind,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
  type ASTVisitor,
} from 'graphql';

// Rejects operations nested deeper than MAX_DEPTH field levels (fragments are
// followed). Relation fields resolve per row, so an unbounded nesting such as
// issues → children → children … multiplies the queries per level. The deepest
// operation the Linear SDK sends stays well under the limit (see
// __tests__/unit/sdk-documents.test.ts).
export const MAX_DEPTH = 12;

function depthOf(
  set: SelectionSetNode | undefined,
  fragments: Record<string, FragmentDefinitionNode>,
  seen: Set<string>,
): number {
  if (!set) return 0;
  let max = 0;
  for (const sel of set.selections) {
    let depth = 0;
    if (sel.kind === Kind.FIELD)
      depth = sel.selectionSet ? 1 + depthOf(sel.selectionSet, fragments, seen) : 1;
    else if (sel.kind === Kind.INLINE_FRAGMENT) depth = depthOf(sel.selectionSet, fragments, seen);
    else if (sel.kind === Kind.FRAGMENT_SPREAD && !seen.has(sel.name.value)) {
      const fragment = fragments[sel.name.value];
      seen.add(sel.name.value);
      depth = depthOf(fragment?.selectionSet, fragments, seen);
      seen.delete(sel.name.value);
    }
    max = Math.max(max, depth);
  }
  return max;
}

export function maxDepthRule(context: ValidationContext): ASTVisitor {
  const fragments: Record<string, FragmentDefinitionNode> = {};
  for (const def of context.getDocument().definitions)
    if (def.kind === Kind.FRAGMENT_DEFINITION) fragments[def.name.value] = def;
  return {
    OperationDefinition(node) {
      const depth = depthOf(node.selectionSet, fragments, new Set());
      if (depth > MAX_DEPTH)
        context.reportError(
          new GraphQLError(`Query depth ${depth} exceeds the maximum of ${MAX_DEPTH}`, {
            nodes: [node],
            extensions: { code: 'INVALID_INPUT' },
          }),
        );
    },
  };
}
