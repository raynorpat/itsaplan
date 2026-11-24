import { useCallback, useRef } from 'react';
import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import type { TeamDetail } from '@/types/team';
import type { Issue } from '@/types/issue';
import { type Maps } from '@/utils/team';
import type { ListRowProperties } from '@/utils/list';
import { cycleLabel } from '@/utils/cycles';
import { isDueOverdue } from '@/utils/dates';
import { DRAG_ACTIVATION_DISTANCE } from '@/lib/dnd';
import { useIsPhone } from '@/hooks/useIsPhone';
import { usePermissions } from '@/hooks/usePermissions';
import { cn } from '@/lib/utils';
import IssueContextMenu from '@/components/common/issue/IssueContextMenu';
import { DropLine } from '@/components/common/board/shared/DropLine';
import { ListRowContent, type ListRowData } from './ListRowContent';
import { projectDisplayName } from '@/utils/projectMeta';

// The display data of a team issue, resolved through the team's lookup maps.
function rowData(issue: Issue, maps: Maps): ListRowData {
  const state = maps.columnById.get(issue.stateId);
  const person = (id: string | null | undefined) => {
    const u = id != null ? maps.assigneeById.get(id) : undefined;
    return u ? { name: u.name, image: u.image ?? null } : null;
  };
  const cycle = issue.cycleId != null ? maps.cycleById.get(issue.cycleId) : undefined;
  return {
    priority: issue.priority,
    identifier: issue.identifier,
    title: issue.title,
    state: state ? { type: state.stateType, color: state.color, name: state.name } : null,
    labels: issue.labelIds.flatMap((id) => {
      const l = maps.labelById.get(id);
      return l ? [{ id, name: l.name, color: l.color }] : [];
    }),
    project: issue.project ? projectDisplayName(issue.project) : null,
    cycle: cycle ? cycleLabel(cycle) : null,
    dueDate: issue.dueDate
      ? { date: issue.dueDate, overdue: isDueOverdue(issue.dueDate, state?.stateType) }
      : null,
    assignee: person(issue.assigneeUserId),
    delegate: person(issue.delegateUserId),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    requests: { requests: issue.requests },
  };
}

// A draggable, droppable list row. Dragging it starts a move; dropping another
// row on it inserts before this one (onDrop). A plain click opens the issue; with
// a selection active, or with Shift / Cmd / Ctrl held, the click selects instead
// (onSelect), as on the board.
export function ListRow({
  team,
  issue,
  maps,
  properties,
  indented,
  selected,
  focused,
  selecting,
  dropDisabled,
  onDrop,
  onOpen,
  onSelect,
  readOnly,
}: {
  team: TeamDetail;
  issue: Issue;
  maps: Maps;
  properties: ListRowProperties;
  // Rows under a sub-section are indented to sit below their sub-header.
  indented: boolean;
  selected: boolean;
  // The keyboard's row (J / K): shown with the hover fill so it stays visible.
  focused: boolean;
  selecting: boolean;
  // Dropping between rows only holds under manual ordering. With any other sort
  // the row stops being a drop target so the pointer falls through to the section
  // header, which refuses the move and explains why.
  dropDisabled: boolean;
  onDrop: (draggedId: string) => void;
  onOpen: () => void;
  onSelect: (range: boolean) => void;
  readOnly?: boolean;
}) {
  // Drag is disabled on phones so a touch scrolls the list instead of picking up
  // a row, and without work_items edit (reordering is an issue edit).
  const { can } = usePermissions();
  const {
    setNodeRef: dragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: issue.id, disabled: useIsPhone() || !can('work_items', 'edit') });
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `row:${issue.id}`,
    disabled: dropDisabled,
    data: { onDrop: (draggedId: string) => draggedId !== issue.id && onDrop(draggedId) },
  });
  // The insertion marker sits at this row's top edge: a drop inserts before it.
  const { active } = useDndContext();
  const showDropLine = isOver && String(active?.id) !== issue.id;
  const mergedRef = useCallback(
    (el: HTMLElement | null) => {
      dragRef(el);
      dropRef(el);
    },
    [dragRef, dropRef],
  );

  // The browser still fires a click after a drag ends; a click that moved further
  // than the drag activation distance is the end of a drag, not a click.
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const isClick = (e: { clientX: number; clientY: number }) => {
    const start = pressedAt.current;
    pressedAt.current = null;
    return (
      !start || Math.hypot(e.clientX - start.x, e.clientY - start.y) <= DRAG_ACTIVATION_DISTANCE
    );
  };

  return (
    <IssueContextMenu team={team} issue={issue}>
      <div
        ref={mergedRef}
        {...attributes}
        {...listeners}
        data-issue-id={issue.id}
        data-focused={focused || undefined}
        aria-current={focused || undefined}
        aria-pressed={selecting ? selected : undefined}
        onPointerDown={(e) => {
          pressedAt.current = { x: e.clientX, y: e.clientY };
          listeners?.onPointerDown?.(e);
        }}
        onClick={(e) => {
          if (!isClick(e)) return;
          // A click leaves DOM focus on the row (it is a drag handle), where Enter
          // and Space start a keyboard drag; handing focus back to the page keeps
          // the list's J / K / X / Enter working after a click.
          e.currentTarget.blur();
          if (!readOnly && (selecting || e.shiftKey || e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSelect(e.shiftKey);
          } else {
            onOpen();
          }
        }}
        className={cn(
          'relative cursor-grab border-b border-border/50 select-none hover:bg-accent/40 sm:touch-none',
          focused && 'bg-accent/60',
          isDragging && 'opacity-40',
        )}
      >
        {showDropLine && <DropLine className="top-0" />}
        <ListRowContent
          data={rowData(issue, maps)}
          properties={properties}
          indented={indented}
          selected={selected}
        />
      </div>
    </IssueContextMenu>
  );
}
