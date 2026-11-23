import { type ReactNode } from 'react';
import { Target } from 'lucide-react';
import { type TeamDetail, type IssueDetail as IssueDetailRow, type IssuePatch } from '@/lib/api';
import AssigneeSelect from '@/components/common/fields/AssigneeSelect';
import DatePill from '@/components/common/fields/DatePill';
import { Pill } from '@/components/common/fields/Pill';
import ReadOnlyPill from '@/components/common/fields/ReadOnlyPill';
import LabelsSelect from '@/components/common/fields/LabelsSelect';
import PrioritySelect from '@/components/common/fields/PrioritySelect';
import StatusSelect from '@/components/common/fields/StatusSelect';
import CycleSelect from '@/components/common/fields/CycleSelect';
import { cyclesVisible } from '@/utils/cycles';
import ProjectSelect from '../fields/ProjectSelect';
import IssueMilestoneName from '../fields/IssueMilestoneName';

// One property row in the two-column list: name on the left, control on the right.
function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="pt-1.5 text-sm text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </>
  );
}

// The Properties grid of the issue detail: status, assignee, priority, project,
// cycle, dates and labels, each editable inline. In the page layout it is a bordered card; in the panel a plain block.
export default function IssueProperties({
  team,
  issue,
  onPatch,
  onToggleLabel,
  hasSidebar,
  readOnly,
}: {
  team: TeamDetail;
  issue: IssueDetailRow;
  onPatch: (fields: IssuePatch) => void;
  onToggleLabel: (id: string) => void;
  hasSidebar: boolean;
  // When true every control is a non-interactive display of its value (public
  // shared page). The onPatch/onToggleLabel callbacks are never called.
  readOnly?: boolean;
}) {
  const hasMembers = team.assignees.length > 0;
  const rows = (
    <>
      <PropertyRow label="State">
        <StatusSelect
          columns={team.states}
          value={issue.stateId}
          onChange={(id) => onPatch({ stateId: id })}
          readOnly={readOnly}
        />
      </PropertyRow>

      {hasMembers && (
        <PropertyRow label="Assignee">
          <AssigneeSelect
            assignees={team.assignees}
            value={issue.assigneeUserId}
            onChange={(userId) => onPatch({ assigneeUserId: userId })}
            readOnly={readOnly}
          />
        </PropertyRow>
      )}

      <PropertyRow label="Priority">
        <PrioritySelect
          value={issue.priority}
          onChange={(v) => onPatch({ priority: v })}
          readOnly={readOnly}
        />
      </PropertyRow>

      <PropertyRow label="Project">
        {readOnly ? (
          // Read-only shows the linked project from the issue itself, avoiding
          // the authenticated projects query the editable select runs.
          <ReadOnlyPill>
            <Pill active={!!issue.project}>
              <Target />
              {issue.project?.title ?? 'Project'}
            </Pill>
          </ReadOnlyPill>
        ) : (
          <ProjectSelect
            teamKey={team.team.key}
            value={issue.project?.id ?? null}
            onChange={(id) => onPatch({ projectId: id })}
          />
        )}
      </PropertyRow>

      {/* Hidden read-only: the milestone name needs the authenticated milestones query. */}
      {!readOnly && issue.project && issue.projectMilestoneId && (
        <PropertyRow label="Milestone">
          <IssueMilestoneName projectId={issue.project.id} milestoneId={issue.projectMilestoneId} />
        </PropertyRow>
      )}

      {cyclesVisible(team) && (
        <PropertyRow label="Cycle">
          <CycleSelect
            cycles={team.teamCycles}
            value={issue.cycleId}
            onChange={(id) => onPatch({ cycleId: id })}
            readOnly={readOnly}
          />
        </PropertyRow>
      )}

      <PropertyRow label="Due date">
        <DatePill
          value={issue.dueDate}
          placeholder="Due date"
          onChange={(v) => onPatch({ dueDate: v })}
          readOnly={readOnly}
        />
      </PropertyRow>

      {team.labels.length > 0 && (
        <PropertyRow label="Labels">
          <LabelsSelect
            labels={team.labels}
            groups={team.labelGroups}
            value={issue.labelIds}
            onToggle={onToggleLabel}
            readOnly={readOnly}
          />
        </PropertyRow>
      )}
    </>
  );

  const inner = (
    <>
      <h3
        className={`text-xs font-medium text-muted-foreground ${hasSidebar ? 'mb-2.5' : 'mb-3 tracking-wide uppercase'}`}
      >
        Properties
      </h3>
      <div
        className={`grid ${hasSidebar ? 'grid-cols-[72px_1fr] gap-x-2' : 'grid-cols-[110px_1fr] gap-x-3'} items-start gap-y-2.5`}
      >
        {rows}
      </div>
    </>
  );

  // In the page layout the properties become a bordered card in the right
  // sidebar; in the panel they stay a plain block under the content.
  return hasSidebar ? (
    <div className="rounded-lg border bg-card/50 p-3.5">{inner}</div>
  ) : (
    <div className="mt-6 border-t pt-5">{inner}</div>
  );
}
