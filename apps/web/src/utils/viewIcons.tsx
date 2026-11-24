// Icon choices for a saved view. kanban_views.icon stores one of these keys (or
// null for the default). Kept to a small curated set so the picker fits in a
// popover and every stored name resolves to a component.

import {
  Bot,
  Bug,
  Calendar,
  CheckCircle,
  Columns3,
  GanttChart,
  Clock,
  Flag,
  Inbox,
  Layers,
  List,
  BookOpen,
  Star,
  Tag,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { WorkItemsView } from './viewTypes';

export const VIEW_ICONS: Record<string, LucideIcon> = {
  list: List,
  bug: Bug,
  post: BookOpen,
  user: User,
  bot: Bot,
  star: Star,
  flag: Flag,
  inbox: Inbox,
  check: CheckCircle,
  clock: Clock,
  layers: Layers,
  tag: Tag,
  calendar: Calendar,
};

export const VIEW_ICON_NAMES = Object.keys(VIEW_ICONS);

// The icon of a view with no chosen icon (or one no longer offered): its layout's.
const LAYOUT_ICONS: Record<WorkItemsView, LucideIcon> = {
  list: List,
  kanban: Columns3,
  timeline: GanttChart,
  calendar: Calendar,
};

export function viewIconFor(name: string | null, layout: WorkItemsView): LucideIcon {
  return (name && VIEW_ICONS[name]) || LAYOUT_ICONS[layout];
}

// Renders a view's icon; without a chosen one, its layout's (the list icon when the
// layout is not given).
export function ViewIcon({
  name,
  layout = 'list',
  className,
}: {
  name: string | null;
  layout?: WorkItemsView;
  className?: string;
}) {
  const Icon = viewIconFor(name, layout);
  return <Icon className={className} />;
}
