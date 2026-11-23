'use client';
import { applicableLabels } from '@/utils/labels';

import { useState } from 'react';
import { Archive, Bot, CircleDashed, RefreshCcw, Tag, Target, Trash2, User, X } from 'lucide-react';
import type { TeamDetail } from '@/types/team';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectsQuery } from '@/services/projects.service';
import { LINKABLE_STATUSES } from '@/utils/projectMeta';
import { assignableCycles, cycleLabel, cyclesVisible } from '@/utils/cycles';
import { cn } from '@/lib/utils';
import { colorDot } from '@/components/common/fields/colorDot';
import { PRIORITY_FIELDS } from '@/components/common/fields/priorityFields';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { StateIcon } from '@/components/common/issue/IssueIcons';
import { useSelection } from '@/context/useSelection';
import { useBulkActions } from '@/hooks/useBulkActions';
import { BarMenu } from './BarMenu';

// Floating bar shown while the kanban board is in selection mode. Each control
// applies one field to every selected issue at once; archive and delete run their
// respective bulk mutations. Selection is kept after a field edit (the applied
// change stays visible and further edits can be chained) and self-empties after
// archive/delete as those issues leave the board.
export function BulkActionBar({ team }: { team: TeamDetail }) {
  const selection = useSelection();
  const { can } = usePermissions();
  const bulk = useBulkActions(team);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Projects are not in the board scaffold. The bulk picker fetches the first
  // page of linkable (open) projects only while selection is active, and only
  // while the team shows the Projects section (with none loaded the picker
  // is left out).
  const projectsKey = selection.isSelecting ? team.team.key : null;
  const { data } = useProjectsQuery(projectsKey, {
    statuses: LINKABLE_STATUSES,
    pageSize: 50,
  });
  const projects = data?.items ?? [];

  if (!selection.isSelecting) return null;

  const ids = [...selection.selected];
  const canEdit = can('work_items', 'edit');
  const canDelete = can('work_items', 'delete');
  const members = team.assignees;
  const disabled = bulk.pending;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
        <div
          className={cn(
            'pointer-events-auto flex items-center gap-1 rounded-lg border bg-popover p-1 pl-3 shadow-lg',
            disabled && 'opacity-70',
          )}
        >
          <span className="pr-1 text-sm font-medium whitespace-nowrap">{ids.length} selected</span>

          {canEdit && (
            <>
              <div className="mx-1 h-5 w-px bg-border" />

              <BarMenu
                icon={<CircleDashed className="size-4" />}
                label="Status"
                disabled={disabled}
              >
                {team.states.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onSelect={() => void bulk.patch(ids, { stateId: c.id })}
                  >
                    <StateIcon stateType={c.stateType} color={c.color} className="size-3.5" />
                    <span className="truncate">{c.name}</span>
                  </DropdownMenuItem>
                ))}
              </BarMenu>

              <BarMenu icon={PRIORITY_FIELDS[0].icon} label="Priority" disabled={disabled}>
                {PRIORITY_FIELDS.map((p) => (
                  <DropdownMenuItem
                    key={p.value || 'none'}
                    onSelect={() => void bulk.patch(ids, { priority: p.value })}
                  >
                    {p.icon}
                    <span className="flex-1">{p.label}</span>
                  </DropdownMenuItem>
                ))}
              </BarMenu>

              {members.length > 0 && (
                <BarMenu icon={<User className="size-4" />} label="Assignee" disabled={disabled}>
                  <DropdownMenuItem onSelect={() => void bulk.patch(ids, { assigneeUserId: null })}>
                    <CircleDashed />
                    <span className="flex-1">No assignee</span>
                  </DropdownMenuItem>
                  {members.map((a) => (
                    <DropdownMenuItem
                      key={a.userId}
                      onSelect={() => void bulk.patch(ids, { assigneeUserId: a.userId })}
                    >
                      <User />
                      <span className="flex-1 truncate">{a.name}</span>
                    </DropdownMenuItem>
                  ))}
                </BarMenu>
              )}

              {team.delegates.length > 0 && (
                <BarMenu icon={<Bot className="size-4" />} label="Delegate" disabled={disabled}>
                  <DropdownMenuItem onSelect={() => void bulk.patch(ids, { delegateUserId: null })}>
                    <CircleDashed />
                    <span className="flex-1">No delegate</span>
                  </DropdownMenuItem>
                  {team.delegates.map((a) => (
                    <DropdownMenuItem
                      key={a.userId}
                      onSelect={() => void bulk.patch(ids, { delegateUserId: a.userId })}
                    >
                      <Bot />
                      <span className="flex-1 truncate">{a.name}</span>
                    </DropdownMenuItem>
                  ))}
                </BarMenu>
              )}

              {projects.length > 0 && (
                <BarMenu icon={<Target className="size-4" />} label="Project" disabled={disabled}>
                  <DropdownMenuItem onSelect={() => void bulk.patch(ids, { projectId: null })}>
                    <CircleDashed />
                    <span className="flex-1">No project</span>
                  </DropdownMenuItem>
                  {projects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onSelect={() => void bulk.patch(ids, { projectId: project.id })}
                    >
                      <Target />
                      <span className="flex-1 truncate">{project.name}</span>
                    </DropdownMenuItem>
                  ))}
                </BarMenu>
              )}

              {cyclesVisible(team) && (
                <BarMenu icon={<RefreshCcw className="size-4" />} label="Cycle" disabled={disabled}>
                  <DropdownMenuItem onSelect={() => void bulk.patch(ids, { cycleId: null })}>
                    <CircleDashed />
                    <span className="flex-1">No cycle</span>
                  </DropdownMenuItem>
                  {assignableCycles(team.teamCycles, new Date()).map((cycle) => (
                    <DropdownMenuItem
                      key={cycle.id}
                      onSelect={() => void bulk.patch(ids, { cycleId: cycle.id })}
                    >
                      <RefreshCcw />
                      <span className="flex-1 truncate">{cycleLabel(cycle)}</span>
                    </DropdownMenuItem>
                  ))}
                </BarMenu>
              )}

              {applicableLabels(team.labels).length > 0 && (
                <BarMenu icon={<Tag className="size-4" />} label="Labels" disabled={disabled}>
                  {applicableLabels(team.labels).map((l) => (
                    <DropdownMenuItem
                      key={l.id}
                      // Keep the menu open so several labels can be added in one pass.
                      onSelect={(e) => {
                        e.preventDefault();
                        void bulk.addLabel(ids, l.id);
                      }}
                    >
                      {colorDot(l.color)}
                      <span className="flex-1 truncate">{l.name}</span>
                    </DropdownMenuItem>
                  ))}
                </BarMenu>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2"
                disabled={disabled}
                onClick={() => void bulk.archiveAll(ids)}
              >
                <Archive className="size-4" />
                Archive
              </Button>
            </>
          )}

          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-destructive hover:text-destructive"
              disabled={disabled}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          )}

          <div className="mx-1 h-5 w-px bg-border" />

          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={selection.clear}
            title="Clear selection"
          >
            <X />
          </Button>
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete issues"
          confirmLabel={`Delete ${ids.length} issues`}
          onConfirm={async () => {
            await bulk.deleteAll(ids);
            setConfirmingDelete(false);
          }}
          onClose={() => setConfirmingDelete(false)}
        >
          <p className="text-sm text-muted-foreground">
            Delete {ids.length} selected issues? This removes them, their comments, activity and
            attachments. This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
