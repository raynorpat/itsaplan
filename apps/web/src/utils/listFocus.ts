// The row the list's keyboard focus (J / K) is on, per list, kept outside the list
// component so it survives opening an issue as a page and coming back, as in Linear.
// Client memory only: a reload starts without a focused row.
const focusByList = new Map<string, string>();

export function readListFocus(listKey: string): string | null {
  return focusByList.get(listKey) ?? null;
}

export function rememberListFocus(listKey: string, issueId: string | null): void {
  if (issueId == null) focusByList.delete(listKey);
  else focusByList.set(listKey, issueId);
}

export function clearListFocus(): void {
  focusByList.clear();
}
