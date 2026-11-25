'use client';

import type { ReactNode } from 'react';
import { Flame } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import { cn } from '@/lib/utils';
import { formatShortDate } from '@/utils/dates';
import CustomerChip from './CustomerChip';
import type { FeedbackItem } from '@/utils/feedback';

// One feedback item: who asked (avatar, name and customer), the quote, an Important marker, the
// source and date. `actions` is the ⋯ menu where the viewer may change it; `editor`
// replaces the quote while it is being edited; `highlighted` marks the item a link
// opened (/issue/<id>?feedback=<attachmentId>).
export default function FeedbackItemRow({
  item,
  actions,
  editor,
  highlighted,
}: {
  item: FeedbackItem;
  actions?: ReactNode;
  editor?: ReactNode;
  highlighted?: boolean;
}) {
  const name = item.requester?.name ?? 'Unknown person';
  return (
    <li
      id={item.attachmentId ? `feedback-${item.attachmentId}` : undefined}
      className={cn(
        'group flex gap-2.5 rounded-md px-2 py-2 transition-colors',
        highlighted && 'bg-accent',
      )}
    >
      <Avatar name={name} image={item.requester?.avatarUrl} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="truncate font-medium">{name}</span>
          <CustomerChip customer={item.customer} />
          {item.important && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-orange-600 dark:text-orange-400">
              <Flame className="size-3" aria-hidden />
              Important
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {[item.source, formatShortDate(item.createdAt)].filter(Boolean).join(' · ')}
          </span>
          {actions && (
            <span className="shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
              {actions}
            </span>
          )}
        </div>
        {editor ??
          (item.body ? (
            <blockquote className="mt-0.5 border-l-2 pl-2 text-sm whitespace-pre-wrap text-muted-foreground">
              {item.body}
            </blockquote>
          ) : null)}
      </div>
    </li>
  );
}
