import { CalendarDays, Columns3, GanttChart, Rows3, type LucideIcon } from 'lucide-react';
import type { HotkeyId } from '@/utils/hotkeys';

// Shared view-domain types used by both team.ts (sorting) and viewSettings.ts
// (stored settings). Kept in their own module so those two do not import each
// other's types in a cycle.

// Global ordering preference (see App). 'manual' keeps the drag-and-drop order
// the API returns (by position); every other field sorts client-side. Applied
// by the list-like views (List, Board); the date-laid-out Timeline and Calendar
// ignore it.
export type SortField =
  | 'manual'
  | 'title'
  | 'identifier'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'dueDate'
  | 'created'
  | 'updated'
  | 'requests';

export interface Sort {
  field: SortField;
  dir: 'asc' | 'desc';
}

// The order an ordering starts in when it is picked, as in Linear: the most requested,
// newest created and most recently updated first; everything else ascending.
export function sortForField(field: SortField): Sort {
  const desc = field === 'requests' || field === 'created' || field === 'updated';
  return { field, dir: desc ? 'desc' : 'asc' };
}

// The team's display modes: Linear's List and Board, plus Timeline and Calendar.
// Which mode is active is a global preference (see useViewEditor); each mode's
// settings are stored per team (see viewSettings).
export type WorkItemsView = 'list' | 'kanban' | 'timeline' | 'calendar';

const LAYOUT_NAMES: readonly WorkItemsView[] = ['list', 'kanban', 'timeline', 'calendar'];

// Reads a stored layout name, including the former 'table' (now the list) and
// 'board' (now 'kanban'); anything else is null.
export function toLayout(raw: unknown): WorkItemsView | null {
  if (raw === 'table') return 'list';
  if (raw === 'board') return 'kanban';
  return LAYOUT_NAMES.includes(raw as WorkItemsView) ? (raw as WorkItemsView) : null;
}

// Each layout names its hotkey id rather than a key, so the switcher, the global
// key layer and the command palette all read the same binding (see lib/hotkeys).
export const VIEWS: { value: WorkItemsView; label: string; icon: LucideIcon; hotkey: HotkeyId }[] =
  [
    { value: 'list', label: 'List', icon: Rows3, hotkey: 'view.list' },
    { value: 'kanban', label: 'Board', icon: Columns3, hotkey: 'view.kanban' },
    { value: 'timeline', label: 'Timeline', icon: GanttChart, hotkey: 'view.timeline' },
    { value: 'calendar', label: 'Calendar', icon: CalendarDays, hotkey: 'view.calendar' },
  ];

// Fields the team can be ordered by, in the order shown in the menu.
export const SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'title', label: 'Title' },
  { value: 'identifier', label: 'Issue number' },
  { value: 'status', label: 'State' },
  { value: 'priority', label: 'Priority' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'dueDate', label: 'Due date' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'requests', label: 'Requests' },
];
