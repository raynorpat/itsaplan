import { CalendarDays, Columns3, GanttChart, Table2, type LucideIcon } from 'lucide-react';
import type { HotkeyId } from '@/utils/hotkeys';

// Shared view-domain types used by both team.ts (sorting) and viewSettings.ts
// (stored settings). Kept in their own module so those two do not import each
// other's types in a cycle.

// Global ordering preference (see App). 'manual' keeps the drag-and-drop order
// the API returns (by position); every other field sorts client-side. Applied
// by the list-like views (Kanban, Table); the date-laid-out Timeline and Calendar
// ignore it.
export type SortField =
  | 'manual'
  | 'title'
  | 'identifier'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'startDate'
  | 'dueDate'
  | 'created'
  | 'updated';

export interface Sort {
  field: SortField;
  dir: 'asc' | 'desc';
}

// The team's four display modes. Which mode is active is a global preference
// (see App); each mode's settings are stored per team (see viewSettings).
export type WorkItemsView = 'kanban' | 'table' | 'timeline' | 'calendar';

// Each layout names its hotkey id rather than a key, so the switcher, the global
// key layer and the command palette all read the same binding (see lib/hotkeys).
export const VIEWS: { value: WorkItemsView; label: string; icon: LucideIcon; hotkey: HotkeyId }[] =
  [
    { value: 'kanban', label: 'Kanban', icon: Columns3, hotkey: 'view.kanban' },
    { value: 'table', label: 'Table', icon: Table2, hotkey: 'view.table' },
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
  { value: 'startDate', label: 'Start date' },
  { value: 'dueDate', label: 'Due date' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
];
