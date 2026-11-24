import type { Issue, IssuePatch } from '@/types/issue';
import { groupIssues, mergeAssign, nestIssues, positionAt, type IssueGroup } from '@/utils/team';
import { type ViewSettings, type DisplayProperty } from '@/utils/viewSettings';
import {
  blocksShortcuts,
  matchesCombo,
  type HotkeyCombos,
  type KeyEventLike,
} from '@/utils/hotkeys';

// The List layout: one dense line per issue under group headers, as in Linear.

// The fields that sit on the right of a list row, in Linear's order. Priority, ID
// and status lead the row before the title.
export type ListField = Exclude<DisplayProperty, 'priority' | 'id' | 'status'>;
const TRAILING_ORDER: ListField[] = [
  'labels',
  'project',
  'cycle',
  'dueDate',
  'delegate',
  'assignee',
  'created',
  'updated',
];

export interface ListRowProperties {
  leading: { priority: boolean; id: boolean; status: boolean };
  trailing: ListField[];
}

// Which properties a row shows, from the Display settings. The right-hand fields
// keep Linear's order whatever order they were switched on in. The cycle shows
// only while the team's cycles are on.
export function listRowProperties(
  properties: DisplayProperty[],
  cyclesOn: boolean,
): ListRowProperties {
  const on = new Set(properties);
  return {
    leading: { priority: on.has('priority'), id: on.has('id'), status: on.has('status') },
    trailing: TRAILING_ORDER.filter((f) => on.has(f) && (cyclesOn || f !== 'cycle')),
  };
}

// The patch a drop applies: the target group's reassignment (if any) plus the
// position at the drop index within that group's issues.
export function listDropPatch(
  assign: IssuePatch | null,
  bucket: Issue[],
  index: number,
): IssuePatch {
  const position = positionAt(bucket, index);
  return assign ? { ...assign, position } : { position };
}

// The ids a shift-click selects: every row from the anchor (the last row clicked)
// to the clicked one, in list order. Without an anchor on the list, just the
// clicked row.
export function rangeIds(order: string[], anchor: string | null, target: string): string[] {
  const from = anchor == null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(target);
  if (from === -1 || to === -1) return [target];
  const [a, b] = from <= to ? [from, to] : [to, from];
  return order.slice(a, b + 1);
}

// Collapsed sections are a per-team, per-grouping client-only preference,
// persisted so it survives reloads (same pattern as the team's hidden groups).
// The sub-grouping field is part of the key so a different sub-grouping keeps its
// own collapse set.
export function collapsedKey(teamId: string, group: string, subgroup: string): string {
  return `kanban-table-collapsed:${teamId}:${group}:${subgroup}`;
}

// Collapse key for a sub-section: primary group key + sub-group key, so the same
// sub-group value under two different primary groups collapses independently.
function subKey(groupKey: string, sgKey: string): string {
  return `${groupKey}::${sgKey}`;
}

// The list is flattened to one array of section headers and issue rows, then
// virtualized in a single scroll container, so a large backlog renders only the
// rows in (and near) the viewport. `index` on a row is its position within its
// cell's issue list, used to compute the drop position. `assign` is the patch a
// drop onto this item applies (the group/sub-group reassignment); `bucket` is
// the ordered issue list the drop position is measured against. `dropKey`
// identifies the section for the droppable id.
export type FlatItem =
  | {
      kind: 'header';
      group: IssueGroup;
      count: number;
      assign: IssuePatch | null;
      bucket: Issue[];
      dropKey: string;
    }
  | {
      kind: 'subheader';
      sub: IssueGroup;
      count: number;
      assign: IssuePatch | null;
      bucket: Issue[];
      dropKey: string;
    }
  | {
      kind: 'row';
      issue: Issue;
      index: number;
      assign: IssuePatch | null;
      bucket: Issue[];
      dropKey: string;
    };

// Flatten the (optionally two-level) grouping into the virtualized list. A
// row's drop `assign` and `bucket` come from the cell it sits in, so the
// virtualizer render stays a plain lookup-free map.
export function buildListItems({
  groups,
  subGroups,
  sorted,
  settings,
  collapsed,
}: {
  groups: IssueGroup[];
  subGroups: IssueGroup[];
  sorted: Issue[];
  settings: ViewSettings;
  collapsed: Set<string>;
}): FlatItem[] {
  const grouped = settings.group !== 'none';
  const subgrouped = grouped && settings.subgroup !== 'none';
  const items: FlatItem[] = [];

  if (!grouped) {
    sorted.forEach((issue, index) =>
      items.push({ kind: 'row', issue, index, assign: null, bucket: sorted, dropKey: 'all' }),
    );
  } else if (!subgrouped) {
    const issuesByGroup = groupIssues(groups, sorted, settings.group);
    for (const group of groups) {
      const issues = issuesByGroup.get(group.key) ?? [];
      if (!settings.showEmptyGroups && issues.length === 0) continue;
      items.push({
        kind: 'header',
        group,
        count: issues.length,
        assign: group.assign,
        bucket: issues,
        dropKey: group.key,
      });
      if (!collapsed.has(group.key)) {
        issues.forEach((issue, index) =>
          items.push({
            kind: 'row',
            issue,
            index,
            assign: group.assign,
            bucket: issues,
            dropKey: group.key,
          }),
        );
      }
    }
  } else {
    const nested = nestIssues(groups, subGroups, sorted, settings.group, settings.subgroup);
    for (const group of groups) {
      const inner = nested.get(group.key)!;
      // The bucket a drop onto the collapsed group header appends to: every
      // sub-group's issues, in position order, so appending past the last one
      // lands after the whole group rather than after one sub-group.
      const allIssues = subGroups
        .flatMap((sg) => inner.get(sg.key) ?? [])
        .sort((a, b) => a.position - b.position);
      if (!settings.showEmptyGroups && allIssues.length === 0) continue;
      items.push({
        kind: 'header',
        group,
        count: allIssues.length,
        assign: group.assign,
        bucket: allIssues,
        dropKey: group.key,
      });
      if (collapsed.has(group.key)) continue;
      for (const sg of subGroups) {
        const issues = inner.get(sg.key) ?? [];
        if (!settings.showEmptyGroups && issues.length === 0) continue;
        const key = subKey(group.key, sg.key);
        const assign = mergeAssign(group.assign, sg.assign);
        items.push({
          kind: 'subheader',
          sub: sg,
          count: issues.length,
          assign,
          bucket: issues,
          dropKey: key,
        });
        if (collapsed.has(key)) continue;
        issues.forEach((issue, index) =>
          items.push({ kind: 'row', issue, index, assign, bucket: issues, dropKey: key }),
        );
      }
    }
  }

  return items;
}

// The row the list's keyboard focus moves to. `order` is the visible rows top to
// bottom (rows of collapsed groups are not in it). Focus starts at the first row
// going down and the last going up, and stops at the ends, as in Linear.
export function moveFocus(order: string[], current: string | null, step: 1 | -1): string | null {
  if (order.length === 0) return null;
  const at = current != null ? order.indexOf(current) : -1;
  if (at === -1) return step === 1 ? order[0]! : order[order.length - 1]!;
  return order[Math.min(order.length - 1, Math.max(0, at + step))]!;
}

export type ListKeyAction = 'next' | 'prev' | 'select' | 'open';

// The list command a key press stands for, or null. The keys are plain keys, so they
// never fire while the user types or has a dialog or menu open.
export function listKeyAction(
  e: KeyEventLike & { target: EventTarget | null },
  combos: HotkeyCombos,
): ListKeyAction | null {
  if (blocksShortcuts(e.target)) return null;
  if (matchesCombo(e, combos['list.next'])) return 'next';
  if (matchesCombo(e, combos['list.prev'])) return 'prev';
  if (matchesCombo(e, combos['list.select'])) return 'select';
  if (matchesCombo(e, combos['list.open'])) return 'open';
  return null;
}
