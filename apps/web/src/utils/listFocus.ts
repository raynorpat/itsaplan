// The row the list's keyboard focus (J / K) is on, per list, kept outside the list
// component so it survives opening an issue as a page and coming back, as in Linear.
// Client memory only: a reload starts without a focused row.
const focusByList = new Map<string, string>();

type FocusListener = (listKey: string, issueId: string | null) => void;
// The mounted lists, told when another surface (the peek panel's J / K) moves their
// focus so the highlighted row follows the peeked issue.
const listeners = new Set<FocusListener>();

export function readListFocus(listKey: string): string | null {
  return focusByList.get(listKey) ?? null;
}

export function rememberListFocus(listKey: string, issueId: string | null): void {
  if (issueId == null) focusByList.delete(listKey);
  else focusByList.set(listKey, issueId);
  for (const listener of listeners) listener(listKey, issueId);
}

export function subscribeListFocus(listener: FocusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearListFocus(): void {
  focusByList.clear();
}
