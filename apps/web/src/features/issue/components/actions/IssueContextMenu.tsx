import { useContext, useState, type ReactNode } from 'react';
import { applicableLabels } from '@/utils/labels';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Check,
  CircleDashed,
  RefreshCcw,
  ClipboardCopy,
  PanelRight,
  SquareArrowOutUpRight,
  Tag,
  Target,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type { TeamDetail, Issue, IssuePatch } from '@/lib/api';
import { useArchiveIssue, useRestoreIssue, useUpdateIssueDetail } from '@/services/issues.service';
import { useProjectsQuery } from '@/services/projects.service';
import { LINKABLE_STATUSES, STATUS_META } from '@/utils/projectMeta';
import { assignableCycles, cycleLabel, cyclesVisible } from '@/utils/cycles';
import { usePermissions } from '@/hooks/usePermissions';
import { ShellCtx } from '@/context/shellContext';
import { DeleteIssueDialog } from './IssueActions';
import { buildIssuePrompt } from '../../utils/issuePrompt';
import { useSession } from '@/lib/auth-client';
import { toDateStr } from '@/utils/dates';
import { colorDot } from '@/components/common/fields/colorDot';
import { PRIORITY_FIELDS } from '@/components/common/fields/priorityFields';
import { StateIcon } from '../shared/IssueIcons';
import { dueDatePresets, formatPreset } from '../../utils/dueDatePresets';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

// Trailing check on the currently-selected row in a single-select submenu.
function SelectedCheck({ selected }: { selected: boolean }) {
  return selected ? <Check className="ml-auto size-4" /> : null;
}

// Wraps a issue card/row (any single element) so a right-click opens a context
// menu that changes its status, priority, assignee, project, labels or due
// date, or deletes it. Shared by every team view (Kanban, Table, Calendar, Timeline).
// onDeleted lets a host that is showing this one issue (the detail panel/page)
// leave after deletion; the team views leave it unset — the card just
// disappears when the team cache updates.
export default function IssueContextMenu({
  team,
  issue,
  onDeleted,
  children,
}: {
  team: TeamDetail;
  issue: Issue;
  onDeleted?: () => void;
  children: ReactNode;
}) {
  const { can } = usePermissions();
  // Read the Shell directly (not useShell) so this can render outside it: on the
  // public read-only board there is no Shell, and the card is shown without a menu.
  const shell = useContext(ShellCtx);
  const { data: session } = useSession();
  const canEdit = can('work_items', 'edit');
  const canDelete = can('work_items', 'delete');
  const updateIssue = useUpdateIssueDetail(team.team.key);
  const archiveIssue = useArchiveIssue(team.team.key);
  const restoreIssue = useRestoreIssue(team.team.key);
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Projects are not in the board scaffold, so they are fetched here — only
  // while this menu is open, as every card on the board mounts one.
  const projectsQuery = useProjectsQuery(open ? team.team.key : null, {
    statuses: LINKABLE_STATUSES,
    pageSize: 50,
  });

  // No Shell (public share): render the card as-is, without the right-click menu.
  if (!shell) return <>{children}</>;
  const onOpenIssue = shell.onOpenIssue;

  function patch(fields: IssuePatch) {
    updateIssue.mutate({ id: issue.id, patch: fields });
  }

  function toggleLabel(id: string) {
    const next = issue.labelIds.includes(id)
      ? issue.labelIds.filter((x) => x !== id)
      : [...issue.labelIds, id];
    patch({ labelIds: next });
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(buildIssuePrompt(issue, team, session?.user));
    toast.success('Prompt copied to clipboard');
  }

  const currentColumn = team.states.find((c) => c.id === issue.stateId);
  const currentPriority =
    PRIORITY_FIELDS.find((p) => p.value === issue.priority) ?? PRIORITY_FIELDS[0];
  const members = team.assignees;
  const projects = projectsQuery.data?.items ?? [];
  const cycleChoices = assignableCycles(team.teamCycles, new Date());

  return (
    <>
      <ContextMenu onOpenChange={setOpen}>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {/* Both ways to open the issue, regardless of the account's default
              open mode. Reading an issue needs no permission. */}
          <ContextMenuItem onSelect={() => onOpenIssue(issue.id, 'panel')}>
            <PanelRight />
            Preview
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onOpenIssue(issue.id, 'page')}>
            <SquareArrowOutUpRight />
            Go to issue
          </ContextMenuItem>

          <ContextMenuSeparator />

          {canEdit && (
            <>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  {currentColumn ? (
                    <StateIcon
                      stateType={currentColumn.stateType}
                      color={currentColumn.color}
                      className="size-3.5"
                    />
                  ) : (
                    <CircleDashed />
                  )}
                  Status
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-56">
                  {team.states.map((c) => (
                    <ContextMenuItem key={c.id} onSelect={() => patch({ stateId: c.id })}>
                      <StateIcon stateType={c.stateType} color={c.color} className="size-3.5" />
                      <span className="truncate">{c.name}</span>
                      <SelectedCheck selected={c.id === issue.stateId} />
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>

              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  {currentPriority.icon}
                  Priority
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-52">
                  {PRIORITY_FIELDS.map((p) => (
                    <ContextMenuItem
                      key={p.value || 'none'}
                      onSelect={() => patch({ priority: p.value })}
                    >
                      {p.icon}
                      <span className="flex-1">{p.label}</span>
                      <SelectedCheck selected={p.value === issue.priority} />
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>

              {members.length > 0 && (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <User />
                    Assignee
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-56">
                    <ContextMenuItem onSelect={() => patch({ assigneeUserId: null })}>
                      <CircleDashed />
                      <span className="flex-1">No assignee</span>
                      <SelectedCheck selected={issue.assigneeUserId == null} />
                    </ContextMenuItem>
                    {members.map((a) => (
                      <ContextMenuItem
                        key={a.userId}
                        onSelect={() => patch({ assigneeUserId: a.userId })}
                      >
                        <User />
                        <span className="flex-1 truncate">{a.name}</span>
                        <SelectedCheck selected={a.userId === issue.assigneeUserId} />
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              )}

              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  {issue.project ? <Target /> : <CircleDashed />}
                  Project
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-56">
                  <ContextMenuItem onSelect={() => patch({ projectId: null })}>
                    <CircleDashed />
                    <span className="flex-1">No project</span>
                    <SelectedCheck selected={issue.project == null} />
                  </ContextMenuItem>
                  {projects.map((it) => (
                    <ContextMenuItem key={it.id} onSelect={() => patch({ projectId: it.id })}>
                      {colorDot(STATUS_META[it.status].color)}
                      <span className="flex-1 truncate">{it.name}</span>
                      <SelectedCheck selected={it.id === issue.project?.id} />
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>

              {cyclesVisible(team) && (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <RefreshCcw />
                    Cycle
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-56">
                    <ContextMenuItem onSelect={() => patch({ cycleId: null })}>
                      <CircleDashed />
                      <span className="flex-1">No cycle</span>
                      <SelectedCheck selected={issue.cycleId == null} />
                    </ContextMenuItem>
                    {cycleChoices.map((cycle) => (
                      <ContextMenuItem key={cycle.id} onSelect={() => patch({ cycleId: cycle.id })}>
                        <RefreshCcw />
                        <span className="flex-1 truncate">{cycleLabel(cycle)}</span>
                        <SelectedCheck selected={cycle.id === issue.cycleId} />
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              )}

              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <CalendarClock />
                  Due date
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-72">
                  {dueDatePresets().map((p) => (
                    <ContextMenuItem
                      key={p.key}
                      onSelect={() => patch({ dueDate: toDateStr(p.date) })}
                    >
                      <CalendarClock />
                      <span className="whitespace-nowrap">{p.label}</span>
                      <ContextMenuShortcut className="whitespace-nowrap">
                        {formatPreset(p.date)}
                      </ContextMenuShortcut>
                    </ContextMenuItem>
                  ))}
                  {issue.dueDate && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => patch({ dueDate: null })}>
                        <X />
                        Clear due date
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuSubContent>
              </ContextMenuSub>

              {applicableLabels(team.labels).length > 0 && (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Tag />
                    Labels
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-56">
                    {applicableLabels(team.labels).map((l) => (
                      <ContextMenuItem
                        key={l.id}
                        // Keep the menu open so several labels can be toggled in one pass.
                        onSelect={(e) => {
                          e.preventDefault();
                          toggleLabel(l.id);
                        }}
                      >
                        {colorDot(l.color)}
                        <span className="flex-1 truncate">{l.name}</span>
                        <SelectedCheck selected={issue.labelIds.includes(l.id)} />
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              )}
            </>
          )}

          {canEdit && <ContextMenuSeparator />}

          {/* Copy the issue as a Markdown prompt for an AI coding agent. Available
              to everyone — it only reads the issue, so no permission gate. */}
          <ContextMenuItem onSelect={copyPrompt}>
            <ClipboardCopy />
            Copy Prompt
          </ContextMenuItem>

          {canEdit && <ContextMenuSeparator />}

          {/* Archiving hides the issue from the board but keeps it; restore brings it back. */}
          {canEdit &&
            (issue.archivedAt ? (
              <ContextMenuItem onSelect={() => restoreIssue.mutate(issue.id)}>
                <ArchiveRestore />
                Restore
              </ContextMenuItem>
            ) : (
              <ContextMenuItem
                onSelect={() => {
                  archiveIssue.mutate(issue.id);
                  onDeleted?.();
                }}
              >
                <Archive />
                Archive
              </ContextMenuItem>
            ))}

          {canDelete && <ContextMenuSeparator />}

          {canDelete && (
            <ContextMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
              <Trash2 />
              Delete
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {confirmingDelete && (
        <DeleteIssueDialog
          team={team}
          issue={issue}
          onClose={() => setConfirmingDelete(false)}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}
