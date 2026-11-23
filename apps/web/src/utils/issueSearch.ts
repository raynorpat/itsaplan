// A command-palette search hit: enough to list a match and open it.
export interface IssueSearchHit {
  id: string;
  sequenceNumber: number;
  identifier: string;
  title: string;
  archived: boolean;
}

export function toSearchHit(node: {
  id: string;
  number: number;
  identifier: string;
  title: string;
  archivedAt: string | null;
}): IssueSearchHit {
  return {
    id: node.id,
    sequenceNumber: node.number,
    identifier: node.identifier,
    title: node.title,
    archived: node.archivedAt != null,
  };
}
