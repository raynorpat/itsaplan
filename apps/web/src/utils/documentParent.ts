import { qk } from '@/services/queryKeys';

// What a document belongs to: an issue or a project (Linear's issue and project
// documents).
export type DocumentParent = { issueId: string } | { projectId: string };

// The documentCreate input field that attaches a new document to its parent.
export function documentParentInput(
  parent: DocumentParent,
): { issueId: string } | { projectId: string } {
  if ('issueId' in parent) return { issueId: parent.issueId };
  return { projectId: parent.projectId };
}

// The cache entry that lists the parent's documents.
export function documentsKey(parent: DocumentParent): readonly unknown[] {
  if ('issueId' in parent) return qk.issueDocuments(parent.issueId);
  return qk.projectDocuments(parent.projectId);
}
