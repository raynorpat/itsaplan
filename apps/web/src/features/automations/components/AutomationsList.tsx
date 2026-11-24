'use client';

import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDndSensors } from '@/lib/dnd';
import { useReorderAutomation } from '../services/automations.service';
import { reorderIds, reorderWrites, type WorkflowRule } from '../utils/rules';
import AutomationRow from './AutomationRow';

// The team's active rules in run order (top runs first); drag a rule's handle to
// move it. Usually only the moved rule's sortOrder is written (reorderWrites).
export default function AutomationsList({
  rules,
  teamId,
  teamKey,
  canEdit,
}: {
  rules: WorkflowRule[];
  teamId: string;
  teamKey: string;
  canEdit: (rule: WorkflowRule) => boolean;
}) {
  const sensors = useDndSensors();
  const reorder = useReorderAutomation(teamId);

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const movedId = String(e.active.id);
    const ids = reorderIds(rules, movedId, String(e.over.id));
    void (async () => {
      for (const write of reorderWrites(rules, ids, movedId)) await reorder.mutateAsync(write);
    })().catch(() => {});
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={rules.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        <div className="rounded-md border">
          {rules.map((rule) => (
            <AutomationRow
              key={rule.id}
              rule={rule}
              teamKey={teamKey}
              canEdit={canEdit(rule)}
              sortable
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
