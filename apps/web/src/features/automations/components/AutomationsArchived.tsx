'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { DndContext } from '@dnd-kit/core';
import type { WorkflowRule } from '../utils/rules';
import AutomationRow from './AutomationRow';

// The team's archived rules, collapsed until opened. They do not run and are not
// ordered; the menu unarchives or deletes them.
export default function AutomationsArchived({
  rules,
  teamKey,
  canEdit,
}: {
  rules: WorkflowRule[];
  teamKey: string;
  canEdit: (rule: WorkflowRule) => boolean;
}) {
  const [open, setOpen] = useState(false);
  if (rules.length === 0) return null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="mt-8">
      <h2 className="text-xs font-medium text-muted-foreground">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 py-2 hover:text-foreground"
        >
          <Chevron className="size-3.5" />
          Archived ({rules.length})
        </button>
      </h2>
      {open && (
        // AutomationRow is sortable; a DndContext without a SortableContext keeps
        // these rows still.
        <DndContext>
          <div className="rounded-md border">
            {rules.map((rule) => (
              <AutomationRow
                key={rule.id}
                rule={rule}
                teamKey={teamKey}
                canEdit={canEdit(rule)}
                sortable={false}
              />
            ))}
          </div>
        </DndContext>
      )}
    </section>
  );
}
