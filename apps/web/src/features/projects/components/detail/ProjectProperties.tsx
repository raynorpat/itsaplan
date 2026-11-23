'use client';

import type { TeamDetail } from '@/lib/api';
import {
  useProjectLabelsQuery,
  useUpdateProject,
  type ProjectChange,
  type ProjectDetail,
} from '@/services/projects.service';
import AssigneeSelect from '@/components/common/fields/AssigneeSelect';
import DatePill from '@/components/common/fields/DatePill';
import LabelsSelect from '@/components/common/fields/LabelsSelect';
import PrioritySelect from '@/components/common/fields/PrioritySelect';
import ProjectStatusSelect from '../shared/ProjectStatusSelect';
import ProjectMembersField from './ProjectMembersField';
import ProjectTeamsField from './ProjectTeamsField';

// The project's properties as pills, each saved through projectUpdate as it is
// picked. Read-only for a viewer who may not edit projects.
export default function ProjectProperties({
  project,
  team,
  canEdit,
}: {
  project: ProjectDetail;
  team: TeamDetail;
  canEdit: boolean;
}) {
  const update = useUpdateProject(team.team.key);
  const patch = (p: ProjectChange) => update.mutate({ id: project.id, patch: p });
  const readOnly = !canEdit;

  // Project labels are workspace-level; shaped as team labels (no groups) so the
  // shared LabelsSelect offers them.
  const projectLabels = (useProjectLabelsQuery().data ?? [])
    .filter((l) => !l.isGroup)
    .map((l) => ({
      id: l.id,
      teamId: '',
      groupId: null,
      name: l.name,
      color: l.color,
      retiredAt: null,
    }));

  const toggleLabel = (labelId: string) =>
    patch({
      labelIds: project.labelIds.includes(labelId)
        ? project.labelIds.filter((id) => id !== labelId)
        : [...project.labelIds, labelId],
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ProjectStatusSelect
        value={project.status}
        onChange={(status) => patch({ status })}
        readOnly={readOnly}
      />
      <PrioritySelect
        value={project.priority}
        onChange={(priority) => patch({ priority })}
        readOnly={readOnly}
      />
      <AssigneeSelect
        assignees={team.assignees}
        value={project.leadUserId}
        onChange={(leadUserId) => patch({ leadUserId })}
        placeholder="No lead"
        readOnly={readOnly}
      />
      <ProjectMembersField
        project={project}
        assignees={team.assignees}
        onChange={(memberIds) => patch({ memberIds })}
        readOnly={readOnly}
      />
      <DatePill
        value={project.startDate}
        placeholder="Start date"
        onChange={(startDate) => patch({ startDate })}
        readOnly={readOnly}
      />
      <DatePill
        value={project.targetDate}
        placeholder="Target date"
        onChange={(targetDate) => patch({ targetDate })}
        readOnly={readOnly}
      />
      <ProjectTeamsField project={project} readOnly={readOnly} />
      <LabelsSelect
        labels={projectLabels}
        groups={[]}
        value={project.labelIds}
        onToggle={toggleLabel}
        readOnly={readOnly}
      />
    </div>
  );
}
