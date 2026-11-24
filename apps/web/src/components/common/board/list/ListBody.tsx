import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import type { Issue, IssuePatch } from '@/types/issue';
import { buildGroups, buildMaps, sortIssues, type WorkItemsViewProps } from '@/utils/team';
import { cyclesVisible } from '@/utils/cycles';
import {
  buildListItems,
  collapsedKey,
  listDropPatch,
  listRowProperties,
  listKeyAction,
  moveFocus,
  rangeIds,
  type FlatItem,
} from '@/utils/list';
import { useHotkeyCombos } from '@/context/useHotkeys';
import { useDndSensors } from '@/lib/dnd';
import { usePersistedSet } from '@/hooks/usePersistedSet';
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
  onOpenIssue,
  onAddIssue,
  readOnly,
}: WorkItemsViewProps) {
  const updateIssue = useUpdateIssue(team.team.key);
  const selection = useSelection();
  const [activeId, setActiveId] = useState<string | null>(null);
  // The last row clicked with selection, the start of a shift-click range.
  const anchor = useRef<string | null>(null);
  const sensors = useDndSensors(readOnly);
  const collapsed = usePersistedSet(collapsedKey(team.team.id, settings.group, settings.subgroup));

  const grouped = settings.group !== 'none';
  const subgrouped = grouped && settings.subgroup !== 'none';
  const sorted = sortIssues(team.issues, settings.sort, team);
  const groups = buildGroups(team, settings.group);
  const subGroups = subgrouped ? buildGroups(team, settings.subgroup) : [];
  const maps = buildMaps(team);
  const properties = listRowProperties(settings.properties, cyclesVisible(team));

  const items = buildListItems({
    groups,
    subGroups,
    sorted,
    settings,
    collapsed: collapsed.values,
  });
  const order = useMemo(
    () => items.flatMap((it) => (it.kind === 'row' ? [it.issue.id] : [])),
    [items],
  );

  // The row the keyboard is on (J / K), as in Linear. A row that leaves the list
  // (collapsed, filtered out, archived) drops the focus.
  const [focusRaw, setFocused] = useState<string | null>(null);
  const focused = focusRaw != null && order.includes(focusRaw) ? focusRaw : null;
  const combos = useHotkeyCombos();

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

  // J / K move the focus, X selects the focused row, Enter opens it and Escape
  // clears it (the selection provider clears the selection on Escape). The keys are
  // live only while the list is shown, and never while typing or in a dialog or menu.
  const keys = useRef({ order, focused, items, readOnly, onOpenIssue, selection });
  keys.current = { order, focused, items, readOnly, onOpenIssue, selection };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (e.key === 'Escape') {
        setFocused(null);
        return;
      }
      const action = listKeyAction(e, combos);
      if (action == null) return;
      if (action === 'next' || action === 'prev') {
        e.preventDefault();
        const next = moveFocus(k.order, k.focused, action === 'next' ? 1 : -1);
        setFocused(next);
        const index = k.items.findIndex((it) => it.kind === 'row' && it.issue.id === next);
        if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
        return;
      }
      if (k.focused == null) return;
      e.preventDefault();
      if (action === 'select') {
        if (!k.readOnly) k.selection.toggle(k.focused);
      } else k.onOpenIssue(k.focused);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combos, virtualizer]);

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
        const isCollapsed = collapsed.values.has(item.group.key);
        return (
          <ListSectionHeader
            group={item.group}
            count={item.count}
            collapsed={isCollapsed}
            disabled={subgrouped && !isCollapsed}
            dropId={`sec:${item.dropKey}`}
            onDrop={(id) => moveIssue(id, item.assign, item.bucket, item.bucket.length)}
            onToggle={() => collapsed.toggle(item.group.key)}
            onAddIssue={
              onAddIssue &&
              (() => onAddIssue({ stateId: team.states[0]?.id ?? '', ...item.group.assign }))
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
            collapsed={collapsed.values.has(item.dropKey)}
            dropId={`sec:${item.dropKey}`}
            onDrop={(id) => moveIssue(id, item.assign, item.bucket, item.bucket.length)}
            onToggle={() => collapsed.toggle(item.dropKey)}
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
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((vi) => (
            <div
              key={vi.key}
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
