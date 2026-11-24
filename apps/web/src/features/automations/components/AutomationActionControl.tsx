import type { TeamDetail } from '@/types/team';
import { Textarea } from '@/components/ui/textarea';
import AssigneeSelect from '@/components/common/fields/AssigneeSelect';
import CycleSelect from '@/components/common/fields/CycleSelect';
import DelegateSelect from '@/components/common/fields/DelegateSelect';
import LabelsSelect from '@/components/common/fields/LabelsSelect';
import PrioritySelect from '@/components/common/fields/PrioritySelect';
import ProjectSelect from '@/components/common/fields/ProjectSelect';
import StatusSelect from '@/components/common/fields/StatusSelect';
import type { WorkflowAction } from '../utils/rules';

// The value picker of one action, using the same pickers as the issue page. A null
// assignee, delegate, project or cycle means the action clears that field.
export default function AutomationActionControl({
  action,
  team,
  onChange,
}: {
  action: WorkflowAction;
  team: TeamDetail;
  onChange: (action: WorkflowAction) => void;
}) {
  switch (action.type) {
    case 'setState':
      return (
        <StatusSelect
          columns={team.states}
          value={action.stateId}
          onChange={(stateId) => onChange({ ...action, stateId })}
        />
      );
    case 'setAssignee':
      return (
        <AssigneeSelect
          assignees={team.assignees}
          value={action.userId}
          placeholder="Remove the assignee"
          onChange={(userId) => onChange({ ...action, userId })}
        />
      );
    case 'setDelegate':
      return (
        <DelegateSelect
          delegates={team.delegates}
          value={action.appUserId}
          onChange={(appUserId) => onChange({ ...action, appUserId })}
        />
      );
    case 'setPriority':
      return (
        <PrioritySelect
          value={action.priority}
          onChange={(priority) => onChange({ ...action, priority })}
        />
      );
    case 'addLabels':
    case 'removeLabels':
      return (
        <LabelsSelect
          labels={team.labels}
          groups={team.labelGroups}
          value={action.labelIds}
          onToggle={(id) =>
            onChange({
              ...action,
              labelIds: action.labelIds.includes(id)
                ? action.labelIds.filter((l) => l !== id)
                : [...action.labelIds, id],
            })
          }
        />
      );
    case 'setProject':
      return (
        <ProjectSelect
          teamKey={team.team.key}
          value={action.projectId}
          onChange={(projectId) => onChange({ ...action, projectId })}
        />
      );
    case 'setCycle':
      return (
        <CycleSelect
          cycles={team.teamCycles}
          value={action.cycleId}
          onChange={(cycleId) => onChange({ ...action, cycleId })}
        />
      );
    case 'addComment':
      return (
        <Textarea
          value={action.body}
          onChange={(e) => onChange({ ...action, body: e.target.value })}
          placeholder="Comment, in Markdown"
          aria-label="Comment"
          rows={3}
          className="min-w-72 flex-1"
        />
      );
  }
}
