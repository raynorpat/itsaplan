// The entries of the issue's ⋯ menu, in menu order. An entry the API would refuse
// (archive or delete without the right) is left out rather than disabled.
export type IssueMenuItemId =
  'copyLink' | 'copyPrompt' | 'archive' | 'restore' | 'delete' | 'setParent' | 'removeParent';

export function issueMenuItems({
  canEdit,
  canDelete,
  archived,
}: {
  canEdit: boolean;
  canDelete: boolean;
  archived: boolean;
}): IssueMenuItemId[] {
  const items: IssueMenuItemId[] = ['copyLink', 'copyPrompt'];
  if (canEdit) items.push(archived ? 'restore' : 'archive');
  if (canDelete) items.push('delete');
  return items;
}
