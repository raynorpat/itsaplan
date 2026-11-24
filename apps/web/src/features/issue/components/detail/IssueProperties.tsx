import { type ReactNode } from 'react';
import { Target } from 'lucide-react';
import type { TeamDetail } from '@/types/team';
import type { IssueDetail as IssueDetailRow, IssuePatch } from '@/types/issue';
import AssigneeSelect from '@/components/common/fields/AssigneeSelect';
import DelegateSelect from '@/components/common/fields/DelegateSelect';
import DatePill from '@/components/common/fields/DatePill';
import { Pill } from '@/components/common/fields/Pill';
import ReadOnlyPill from '@/components/common/fields/ReadOnlyPill';
import LabelsSelect from '@/components/common/fields/LabelsSelect';
import PrioritySelect from '@/components/common/fields/PrioritySelect';
import StatusSelect from '@/components/common/fields/StatusSelect';
import CycleSelect from '@/components/common/fields/CycleSelect';
import { cyclesVisible, knownCycles } from '@/utils/cycles';
import ProjectSelect from '@/components/common/fields/ProjectSelect';
import IssueMilestoneName from '../fields/IssueMilestoneName';
import IssueAgentStatus from '../agent/IssueAgentStatus';
import { projectDisplayName } from '@/utils/projectMeta';

// One property in Linear's flat list: the control alone (its pill shows the icon and the
// value); the property's name is its accessible label.
function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="min-w-0">
      {children}
    </div>
  );
}

// The issue's properties as Linear lists them: status, assignee, delegate, priority,
// project and milestone, cycle, due date and labels, each editable inline. In a
// sidebar they are one flat column; in the panel a wrapping row under the content.
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
      <PropertyRow label="Status">
        <StatusSelect
          columns={team.states}
          value={issue.stateId}
          onChange={(id) => onPatch({ stateId: id })}
          readOnly={readOnly}
        />
      </PropertyRow>

      <PropertyRow label="Priority">
        <PrioritySelect
          value={issue.priority}
          onChange={(v) => onPatch({ priority: v })}
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

      {(team.delegates.length > 0 || issue.delegateUserId) && (
        <PropertyRow label="Delegate">
          <div className="flex items-center gap-2">
            <DelegateSelect
              delegates={team.delegates}
              value={issue.delegateUserId}
              onChange={(userId) => onPatch({ delegateUserId: userId })}
              readOnly={readOnly}
            />
            <IssueAgentStatus issueId={issue.id} />
          </div>
        </PropertyRow>
      )}

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

      <PropertyRow label="Project">
        {readOnly ? (
          // Read-only shows the linked project from the issue itself, avoiding
          // the authenticated projects query the editable select runs.
          <ReadOnlyPill>
            <Pill active={!!issue.project}>
              <Target />
              {issue.project ? projectDisplayName(issue.project) : 'Project'}
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
            cycles={knownCycles({ teamCycles: team.teamCycles, issues: [issue] })}
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
    </>
  );

  return hasSidebar ? (
    <div className="flex flex-col items-start gap-1">{rows}</div>
  ) : (
    <div className="mt-5 flex flex-wrap items-center gap-1.5">{rows}</div>
  );
}
