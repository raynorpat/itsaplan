import { preferPrefix } from './dnd';
import type { ListOrderEntry } from './issueNavigation';

// Width of one board column, shared by the flat board and the swimlane grid so
// the column header row lines up with the cells below it.
export const COLUMN_WIDTH = 313;

export const boardCollision = preferPrefix('card:');

// The board's cards in reading order (columns left to right, cards top to bottom),
// for the issue page's previous / next. Collapsed columns show no cards, so their
// issues are left out.
export function boardOrder(
  cells: { key: string; issues: ListOrderEntry[] }[],
  collapsed: ReadonlySet<string> = new Set(),
): ListOrderEntry[] {
  return cells.flatMap((c) =>
    collapsed.has(c.key) ? [] : c.issues.map((i) => ({ id: i.id, identifier: i.identifier })),
  );
}
