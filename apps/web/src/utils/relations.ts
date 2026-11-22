// An issue's relations as Linear lists them on the issue page. `relations` are the
// ones this issue holds (issue = this one); `inverseRelations` point at it
// (relatedIssue = this one). A `blocks` relation reads "blocks" from its issue and
// "blocked by" from its related issue; `duplicate` reads "duplicate of" from the
// duplicate (its issue) and "duplicated by" from the original.

export interface RelatedIssue {
  id: string;
  identifier: string;
  title: string;
}

export interface RelationRow {
  id: string;
  type: string;
  issue: RelatedIssue;
  relatedIssue: RelatedIssue;
}

export type RelationKind = 'blockedBy' | 'blocks' | 'related' | 'duplicateOf' | 'duplicatedBy';

export interface RelationGroup {
  kind: RelationKind;
  items: { relationId: string; issue: RelatedIssue }[];
}

export const RELATION_KIND_LABEL: Record<RelationKind, string> = {
  blockedBy: 'Blocked by',
  blocks: 'Blocks',
  related: 'Related',
  duplicateOf: 'Duplicate of',
  duplicatedBy: 'Duplicated by',
};

const ORDER: RelationKind[] = ['blockedBy', 'blocks', 'related', 'duplicateOf', 'duplicatedBy'];

function ownKind(type: string): RelationKind | null {
  if (type === 'blocks') return 'blocks';
  if (type === 'related' || type === 'similar') return 'related';
  if (type === 'duplicate') return 'duplicateOf';
  return null;
}

function inverseKind(type: string): RelationKind | null {
  if (type === 'blocks') return 'blockedBy';
  if (type === 'related' || type === 'similar') return 'related';
  if (type === 'duplicate') return 'duplicatedBy';
  return null;
}

export function groupRelations(
  relations: RelationRow[],
  inverseRelations: RelationRow[],
): RelationGroup[] {
  const byKind = new Map<RelationKind, RelationGroup['items']>();
  const add = (kind: RelationKind | null, relationId: string, issue: RelatedIssue) => {
    if (!kind) return;
    const items = byKind.get(kind) ?? [];
    items.push({ relationId, issue });
    byKind.set(kind, items);
  };
  for (const r of relations) add(ownKind(r.type), r.id, r.relatedIssue);
  for (const r of inverseRelations) add(inverseKind(r.type), r.id, r.issue);
  return ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({
    kind,
    items: byKind.get(kind)!,
  }));
}
