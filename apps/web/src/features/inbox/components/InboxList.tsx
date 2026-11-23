'use client';

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type Notification } from '@/lib/api';
import InboxListItem from './InboxListItem';

// The scrollable notification list. Empty and loading states render in place. The
// whole list is loaded (the inbox filters it in the browser), so only the rows in
// view are rendered; the open row and the checked rows are owned by the page.
export default function InboxList({
  items,
  isLoading,
  selectedId,
  checkedIds,
  onSelect,
  onCheckedChange,
  onToggleRead,
  onSnooze,
  onArchive,
}: {
  items: Notification[];
  isLoading: boolean;
  selectedId: string | null;
  checkedIds: Set<string>;
  onSelect: (n: Notification) => void;
  onCheckedChange: (n: Notification, checked: boolean) => void;
  onToggleRead: (n: Notification, read: boolean) => void;
  onSnooze: (n: Notification, until: string | null) => void;
  onArchive: (n: Notification) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 10,
    getItemKey: (index) => items[index]!.id,
  });
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No notifications
      </div>
    );
  }
  const selecting = checkedIds.size > 0;
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const n = items[vi.index]!;
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              <InboxListItem
                notification={n}
                selected={n.id === selectedId}
                checked={checkedIds.has(n.id)}
                selecting={selecting}
                onSelect={() => onSelect(n)}
                onCheckedChange={(checked) => onCheckedChange(n, checked)}
                onToggleRead={(read) => onToggleRead(n, read)}
                onSnooze={(until) => onSnooze(n, until)}
                onArchive={() => onArchive(n)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
