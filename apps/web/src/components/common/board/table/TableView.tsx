import { useRef, useState } from 'react';
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { type Issue, type IssuePatch } from '@/lib/api';
import {
  buildGroups,
  buildMaps,
  positionAt,
  sortIssues,
  type WorkItemsViewProps,
} from '@/utils/team';
import { cyclesVisible } from '@/utils/cycles';
import { useDndSensors } from '@/lib/dnd';
import { usePersistedSet } from '@/hooks/usePersistedSet';
import { useUpdateIssue } from '@/services/issues.service';
import { preferPrefix, sortedOrderMessage, type DropData } from '@/utils/dnd';
import { buildTableItems, collapsedKey, resolveColumns, type FlatItem } from '@/utils/table';
import { TableColumnHeader } from './TableColumnHeader';
import { TableSectionHeader } from './TableSectionHeader';
import { TableSubHeader } from './TableSubHeader';
import { TableRow } from './TableRow';

const tableCollision = preferPrefix('row:');

export default function TableView({
  team,
  settings,
  onOpenIssue,
  onAddIssue,
  readOnly,
}: WorkItemsViewProps) {
  const updateIssue = useUpdateIssue(team.team.key);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useDndSensors(readOnly);
  const collapsed = usePersistedSet(collapsedKey(team.team.id, settings.group, settings.subgroup));

  const grouped = settings.group !== 'none';
  const subgrouped = grouped && settings.subgroup !== 'none';
  const sorted = sortIssues(team.issues, settings.sort, team);
  const groups = buildGroups(team, settings.group);
  const subGroups = subgrouped ? buildGroups(team, settings.subgroup) : [];
  const maps = buildMaps(team);

  // A cycle column left in the settings shows only while the team's cycles are on.
  const { columns, gridTemplate, minWidth } = resolveColumns(
    cyclesVisible(team) ? settings.properties : settings.properties.filter((p) => p !== 'cycle'),
  );

  const items = buildTableItems({
    groups,
    subGroups,
    sorted,
    settings,
    collapsed: collapsed.values,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
    getItemKey: (index) => {
      const it = items[index];
      if (it.kind === 'header') return `h${it.group.key}`;
      if (it.kind === 'subheader') return `s${it.dropKey}`;
      return `r${it.issue.id}`;
    },
  });

  // Reordering inside a section only holds when the view is ordered manually: with
  // any other sort field the row snaps back to where the sort puts it. A drop that
  // would only reorder is refused and explained; a drop into another section still
  // goes through, since it changes the grouping field rather than the order.
  const manualOrder = settings.sort.field === 'manual';

  function moveIssue(issueId: string, assign: IssuePatch | null, bucket: Issue[], index: number) {
    if (!manualOrder && bucket.some((i) => i.id === issueId)) {
      toast.info(sortedOrderMessage(settings.sort.field));
      return;
    }
    const position = positionAt(bucket, index);
    updateIssue.mutate({ id: issueId, patch: assign ? { ...assign, position } : { position } });
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
          <TableSectionHeader
            group={item.group}
            count={item.count}
            collapsed={isCollapsed}
            disabled={subgrouped && !isCollapsed}
            dropId={`sec:${item.dropKey}`}
            onDrop={(id) => moveIssue(id, item.assign, item.bucket, item.bucket.length)}
            onToggle={() => collapsed.toggle(item.group.key)}
            onAddIssue={() =>
              onAddIssue({ stateId: team.states[0]?.id ?? '', ...item.group.assign })
            }
            readOnly={readOnly}
          />
        );
      }
      case 'subheader':
        return (
          <TableSubHeader
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
          <TableRow
            team={team}
            issue={item.issue}
            orderedColumns={columns}
            maps={maps}
            showId={settings.properties.includes('id')}
            indented={subgrouped}
            gridTemplate={gridTemplate}
            dropDisabled={!manualOrder && grouped}
            onDrop={(draggedId) => moveIssue(draggedId, item.assign, item.bucket, item.index)}
            onClick={() => onOpenIssue(item.issue.id)}
          />
        );
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={tableCollision}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <TableColumnHeader columns={columns} gridTemplate={gridTemplate} minWidth={minWidth} />

        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
            width: '100%',
            minWidth,
          }}
        >
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
