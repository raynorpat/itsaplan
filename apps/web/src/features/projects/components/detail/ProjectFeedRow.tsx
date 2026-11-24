'use client';

import AppBadge from '@/components/common/AppBadge';
import { formatDistanceToNow, parseISO } from 'date-fns';
import {
  CircleDot,
  CirclePlus,
  Pencil,
  FileText,
  SignalHigh,
  UserRound,
  Calendar,
  Tag,
} from 'lucide-react';
import { formatDate } from '@/utils/dates';
import { priorityLabel } from '@/utils/fieldOptions';
import { STATUS_META } from '@/utils/projectMeta';
import type { ProjectFeedEntry } from '../../utils/projectFeed';

type HistoryEntry = Extract<ProjectFeedEntry, { kind: 'history' }>;

const ICON: Record<string, typeof CircleDot> = {
  created: CirclePlus,
  name: Pencil,
  content: FileText,
  description: FileText,
  status: CircleDot,
  priority: SignalHigh,
  lead: UserRound,
  start_date: Calendar,
  target_date: Calendar,
  label_add: Tag,
  label_remove: Tag,
};

const fmtDate = (v: string | null) => (v ? formatDate(v) : '');

const statusLabel = (v: string | null) =>
  v && v in STATUS_META ? STATUS_META[v as keyof typeof STATUS_META].label : v;

// The verb phrase for one change of the project (Project.history).
function describe(a: HistoryEntry): string {
  switch (a.action) {
    case 'created':
      return 'created the project';
    case 'name':
      return `renamed the project to “${a.to}”`;
    case 'content':
    case 'description':
      return a.to ? 'updated the description' : 'cleared the description';
    case 'status':
      return `set status to ${statusLabel(a.to)}`;
    case 'priority':
      return Number(a.to) ? `set priority to ${priorityLabel(Number(a.to))}` : 'removed priority';
    case 'lead':
      return a.to ? `set lead to ${a.to}` : `removed lead ${a.from ?? ''}`.trim();
    case 'target_date':
      return a.to ? `set target date to ${fmtDate(a.to)}` : 'removed target date';
    case 'start_date':
      return a.to ? `set start date to ${fmtDate(a.to)}` : 'removed start date';
    case 'label_add':
      return `added label ${a.to}`;
    case 'label_remove':
      return `removed label ${a.from}`;
    default:
      return a.action;
  }
}

// One change in the project's activity: an icon, the actor and what changed.
export default function ProjectFeedRow({ entry }: { entry: HistoryEntry }) {
  const Icon = ICON[entry.action] ?? CircleDot;
  return (
    <li className="flex items-center gap-2.5 text-xs">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-3" />
      </span>
      <span className="min-w-0 text-muted-foreground">
        <span className="font-medium">{entry.actorName ?? 'System'}</span>
        {entry.actorIsApp && (
          <>
            {' '}
            <AppBadge />
          </>
        )}{' '}
        {describe(entry)}
        <span className="ml-1.5">
          · {formatDistanceToNow(parseISO(entry.createdAt), { addSuffix: true })}
        </span>
      </span>
    </li>
  );
}
