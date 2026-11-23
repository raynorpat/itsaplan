import type { Issue } from '@/types/issue';

// Puts the issue a mutation returned into the board's cached list, in place of the
// row with the same id. Grouping and ordering are derived from the list on render, so
// a moved issue lands in its new group from its fields alone. Returns the same list
// when the issue is not on the board, so React Query keeps the cached reference.
export function patchIssueInList(list: Issue[], issue: Issue): Issue[] {
  const index = list.findIndex((row) => row.id === issue.id);
  if (index === -1) return list;
  const next = list.slice();
  next[index] = issue;
  return next;
}

// Undoes one failed optimistic edit: puts back the row as it was before that edit and
// leaves every other row alone, so a later edit that succeeded meanwhile stays.
export function rollbackRow(list: Issue[], prevRow: Issue | undefined): Issue[] {
  return prevRow ? patchIssueInList(list, prevRow) : list;
}
