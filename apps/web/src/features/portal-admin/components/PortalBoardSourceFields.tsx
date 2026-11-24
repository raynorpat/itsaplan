import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import LabelsSelect from '@/components/common/fields/LabelsSelect';
import { useTeamScaffold } from '@/services/board.service';
import { useTeamsQuery } from '@/services/teams.service';
import { usePortalProjectOptions } from '../services/portalAdmin.service';
import type { BoardForm } from '../utils/board';
import PortalBoardField from './PortalBoardField';
import PortalBoardTeamSelect from './PortalBoardTeamSelect';

// Which issues the board shows: a public team's or a project's, optionally only those
// with one of chosen labels (offered from the team's labels on a team board).
export default function PortalBoardSourceFields({
  form,
  errors,
  set,
}: {
  form: BoardForm;
  errors: Record<string, string>;
  set: (patch: Partial<BoardForm>) => void;
}) {
  const projects = usePortalProjectOptions().data ?? [];
  const teamKey = useTeamsQuery().data?.find((t) => t.id === form.teamId)?.key ?? null;
  const scaffold = useTeamScaffold(form.source === 'team' ? teamKey : null).data;
  const toggleLabel = (id: string) =>
    set({
      labelIds: form.labelIds.includes(id)
        ? form.labelIds.filter((l) => l !== id)
        : [...form.labelIds, id],
    });

  return (
    <div className="grid gap-4">
      <PortalBoardField id="board-source" label="Shows issues of" error={errors.source}>
        <div className="flex flex-wrap gap-2">
          <Select
            value={form.source}
            onValueChange={(v) => set({ source: v as BoardForm['source'], labelIds: [] })}
          >
            <SelectTrigger id="board-source" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="team">A team</SelectItem>
              <SelectItem value="project">A project</SelectItem>
            </SelectContent>
          </Select>
          {form.source === 'team' ? (
            <PortalBoardTeamSelect
              id="board-team"
              value={form.teamId}
              onChange={(teamId) => set({ teamId, labelIds: [] })}
            />
          ) : (
            <Select value={form.projectId} onValueChange={(projectId) => set({ projectId })}>
              <SelectTrigger aria-label="Project" className="w-full sm:w-72">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </PortalBoardField>
      {scaffold && scaffold.labels.length > 0 && (
        <PortalBoardField
          id="board-labels"
          label="Only issues with these labels"
          hint="Leave empty to show every issue of the team."
        >
          <div id="board-labels">
            <LabelsSelect
              labels={scaffold.labels}
              groups={scaffold.labelGroups}
              value={form.labelIds}
              onToggle={toggleLabel}
            />
          </div>
        </PortalBoardField>
      )}
    </div>
  );
}
