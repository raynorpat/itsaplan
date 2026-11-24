import { issuePath } from '@/utils/paths';
import {
  blocksShortcuts,
  matchesCombo,
  type HotkeyCombos,
  type KeyEventLike,
} from '@/utils/hotkeys';

export type ListOrderEntry = { id: string; identifier: string };

// The rows of the last issue list shown, top to bottom, so the issue page and the
// peek panel can move to the previous / next issue of the list they were opened
// from, as in Linear. Client memory only: a reload forgets it.
let lastOrder: ListOrderEntry[] = [];

export function rememberListOrder(entries: ListOrderEntry[]): void {
  lastOrder = entries;
}

export function readListOrder(): ListOrderEntry[] {
  return lastOrder;
}

export function clearListOrder(): void {
  lastOrder = [];
}

// The issue's place in `order` and its neighbours; null when the issue is not in
// the list. There is no wrapping at either end.
export function adjacentIssue(
  order: ListOrderEntry[],
  id: string,
): {
  index: number;
  total: number;
  prev: ListOrderEntry | null;
  next: ListOrderEntry | null;
} | null {
  const index = order.findIndex((e) => e.id === id);
  if (index < 0) return null;
  return {
    index,
    total: order.length,
    prev: order[index - 1] ?? null,
    next: order[index + 1] ?? null,
  };
}

// The next (dir 1) or previous (dir -1) issue from `id`. While the issue is in the
// live list its neighbours there; once it has left (set to Done with completed
// issues hidden, archived) the nearest issue around its place in `snapshot`, an
// earlier order that contained it, that is still in the live list.
export function stepFrom(
  live: ListOrderEntry[],
  snapshot: ListOrderEntry[],
  id: string,
  dir: 1 | -1,
): ListOrderEntry | null {
  const at = adjacentIssue(live, id);
  if (at) return dir === 1 ? at.next : at.prev;
  const index = snapshot.findIndex((e) => e.id === id);
  if (index < 0) return null;
  const liveIds = new Set(live.map((e) => e.id));
  for (let i = index + dir; i >= 0 && i < snapshot.length; i += dir) {
    if (liveIds.has(snapshot[i].id)) return snapshot[i];
  }
  return null;
}

// "ENG-12" → the page of issue 12 in team ENG.
export function issuePathFromIdentifier(identifier: string): string {
  const cut = identifier.lastIndexOf('-');
  return issuePath(identifier.slice(0, cut), Number(identifier.slice(cut + 1)));
}

// J / K on the issue page: the next / previous issue of the remembered list. Never
// while typing (title, description, comment box) or inside a dialog or menu, and
// not for a key another handler has already taken.
export function pageNavKey(
  e: KeyEventLike & { target: EventTarget | null; defaultPrevented?: boolean },
  combos: HotkeyCombos,
): 'next' | 'prev' | null {
  if (e.defaultPrevented || blocksShortcuts(e.target)) return null;
  if (matchesCombo(e, combos['list.next'])) return 'next';
  if (matchesCombo(e, combos['list.prev'])) return 'prev';
  return null;
}
