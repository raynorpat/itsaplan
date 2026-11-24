import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import type { Issue, IssuePatch } from '@/types/issue';
import { buildGroups, buildMaps, sortIssues, type WorkItemsViewProps } from '@/utils/team';
import { cyclesVisible } from '@/utils/cycles';
import {
  buildListItems,
  listDropPatch,
  listRowProperties,
  rangeIds,
  type FlatItem,
  toggledKeys,
} from '@/utils/list';
import { useListKeyboard } from '@/hooks/useListKeyboard';
import { rememberListOrder } from '@/utils/issueNavigation';
import { useDndSensors } from '@/lib/dnd';
import { useUpdateIssue } from '@/services/issues.service';
import { preferPrefix, sortedOrderMessage, type DropData } from '@/utils/dnd';
import { useSelection } from '@/context/useSelection';
import { ListSectionHeader } from './ListSectionHeader';
import { ListSubHeader } from './ListSubHeader';
import { ListRow } from './ListRow';

const listCollision = preferPrefix('row:');

// The list's rows: section headers and issue rows flattened into one array and
// virtualised in a single scroll container, so a long backlog renders only the
// rows near the viewport.
export function ListBody({
  team,
  settings,
  onSettingsChange,
  onOpenIssue,
  onPeekIssue,
  onAddIssue,
  readOnly,
}: WorkItemsViewProps) {
  const updateIssue = useUpdateIssue(team.team.key);
  const selection = useSelection();
  const [activeId, setActiveId] = useState<string | null>(null);
  // The last row clicked with selection, the start of a shift-click range.
  const anchor = useRef<string | null>(null);
  const sensors = useDndSensors(readOnly);
  // Collapsed groups and sub-sections are part of the display (Linear's
  // hiddenGroupsList), keyed by the grouping field, so they are saved with it.
  const collapsed = useMemo(() => new Set(settings.collapsedGroups), [settings.collapsedGroups]);
  const toggleCollapsed = (key: string) =>
    onSettingsChange({ ...settings, collapsedGroups: toggledKeys(settings.collapsedGroups, key) });

  const listId = useId();
  const grouped = settings.group !== 'none';
  const subgrouped = grouped && settings.subgroup !== 'none';
  // Everything derived from the issues and the Display settings, computed only when
  // they change, not on every key press, selection change or drag.
  const { items, rows, maps, properties } = useMemo(() => {
    const sorted = sortIssues(team.issues, settings.sort, team);
    const groups = buildGroups(team, settings.group);
    const subGroups = subgrouped ? buildGroups(team, settings.subgroup) : [];
    const items = buildListItems({
      groups,
      subGroups,
      sorted,
      settings,
      collapsed,
    });
    return {
      items,
      rows: items.flatMap((it) =>
        it.kind === 'row' ? [{ id: it.issue.id, identifier: it.issue.identifier }] : [],
      ),
      maps: buildMaps(team),
      properties: listRowProperties(settings.properties, cyclesVisible(team)),
    };
  }, [team, settings, subgrouped, collapsed]);

  const order = useMemo(() => rows.map((r) => r.id), [rows]);
  // The issue page and the peek panel move through this list's rows (previous / next).
  useEffect(() => rememberListOrder(rows), [rows]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 12,
    getItemKey: (index) => {
      const it = items[index];
      if (it.kind === 'header') return `h${it.group.key}`;
      if (it.kind === 'subheader') return `s${it.dropKey}`;
      return `r${it.issue.id}`;
    },
  });

  // The row under the pointer, peeked by Space when no row has the keyboard focus.
  const hoveredRef = useRef<string | null>(null);

  // J / K / X / Enter / Space / Escape, with the focused row kept across opening an
  // issue.
  const { focused, setFocused } = useListKeyboard({
    order,
    onOpen: onOpenIssue,
    onPeek: onPeekIssue,
    hoveredRef,
    onSelect: readOnly ? undefined : (id) => selection.toggle(id),
    onFocusMove: (id) => {
      const index = items.findIndex((it) => it.kind === 'row' && it.issue.id === id);
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    },
  });

  // Reordering inside a section only holds when the view is ordered manually: with
  // any other sort the row snaps back to where the sort puts it. A drop that would
  // only reorder is refused and explained; a drop into another section still goes
  // through, since it changes the grouping field rather than the order.
  const manualOrder = settings.sort.field === 'manual';

  function moveIssue(issueId: string, assign: IssuePatch | null, bucket: Issue[], index: number) {
    if (!manualOrder && bucket.some((i) => i.id === issueId)) {
      toast.info(sortedOrderMessage(settings.sort.field));
      return;
    }
    updateIssue.mutate({ id: issueId, patch: listDropPatch(assign, bucket, index) });
  }

  function select(id: string, range: boolean) {
    if (range) selection.add(rangeIds(order, anchor.current, id));
    else selection.toggle(id);
    anchor.current = id;
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const data = e.over?.data.current as DropData | undefined;
    data?.onDrop(String(e.active.id));
  }

  const activeIssue =
    activeId != null ? (team.issues.find((i) => i.id === activeId) ?? null) : null;

  function renderItem(item: FlatItem) {
    switch (item.kind) {
      case 'header': {
        // When sub-grouped, issues live under the sub-headers, so the group header
        // is only a drop target while the group is collapsed and they are hidden.
        const isCollapsed = collapsed.has(item.group.key);
        return (
          <ListSectionHeader
            group={item.group}
            count={item.count}
            collapsed={isCollapsed}
            disabled={subgrouped && !isCollapsed}
            dropId={`sec:${item.dropKey}`}
            onDrop={(id) => moveIssue(id, item.assign, item.bucket, item.bucket.length)}
            onToggle={() => toggleCollapsed(item.group.key)}
            controls={listId}
            onAddIssue={
              onAddIssue && !item.group.deleted
                ? () => onAddIssue({ stateId: team.states[0]?.id ?? '', ...item.group.assign })
                : undefined
            }
            readOnly={readOnly}
          />
        );
      }
      case 'subheader':
        return (
          <ListSubHeader
            sub={item.sub}
            count={item.count}
            collapsed={collapsed.has(item.dropKey)}
            dropId={`sec:${item.dropKey}`}
            onDrop={(id) => moveIssue(id, item.assign, item.bucket, item.bucket.length)}
            onToggle={() => toggleCollapsed(item.dropKey)}
            controls={listId}
          />
        );
      case 'row':
        return (
          <ListRow
            team={team}
            issue={item.issue}
            maps={maps}
            properties={properties}
            indented={subgrouped}
            selected={selection.isSelected(item.issue.id)}
            focused={focused === item.issue.id}
            selecting={selection.isSelecting}
            dropDisabled={!manualOrder && grouped}
            onDrop={(draggedId) => moveIssue(draggedId, item.assign, item.bucket, item.index)}
            onOpen={() => {
              setFocused(item.issue.id);
              onOpenIssue(item.issue.id);
            }}
            onSelect={(range) => select(item.issue.id, range)}
            readOnly={readOnly}
          />
        );
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={listCollision}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      {/* data-list-root: the list keys act while it (or nothing) has DOM focus. */}
      <div
        ref={scrollRef}
        data-list-root
        className="h-full overflow-y-auto"
        onMouseOver={(e) => {
          const row = (e.target as Element).closest('[data-issue-id]');
          hoveredRef.current = row?.getAttribute('data-issue-id') ?? null;
        }}
        onMouseLeave={() => {
          hoveredRef.current = null;
        }}
        // Scrolling moves rows under a still pointer without a mouseover; the next
        // mouse move sets the hovered row again.
        onScroll={() => {
          hoveredRef.current = null;
        }}
      >
        <div
          id={listId}
          role="list"
          aria-label="Issues"
          style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
        >
          {virtualizer.getVirtualItems().map((vi) => (
            <div
              key={vi.key}
              role="listitem"
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {renderItem(items[vi.index])}
            </div>
          ))}
        </div>
      </div>

      {/* dropAnimation disabled: the row is moved optimistically, so animating the
          overlay back to its source position first makes it look like it snaps
          back before landing in its new place. */}
      <DragOverlay dropAnimation={null}>
        {activeIssue ? (
          <div className="flex max-w-[360px] items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-lg">
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {activeIssue.identifier}
            </span>
            <span className="truncate text-foreground">{activeIssue.title}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
