import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTeamScaffold } from '@/services/board.service';
import { useTeamsQuery } from '@/services/teams.service';
import type { BoardForm } from '../utils/board';
import PortalBoardField from './PortalBoardField';
import PortalBoardSwitch from './PortalBoardSwitch';
import PortalBoardTeamSelect from './PortalBoardTeamSelect';

// The label value meaning "the team's Portal label" (created by the API when missing).
const DEFAULT_LABEL = 'default';

// Whether signed-in visitors may suggest requests, and the team, status and label a
// suggestion's new issue gets.
export default function PortalBoardSuggestionFields({
  form,
  errors,
  set,
}: {
  form: BoardForm;
  errors: Record<string, string>;
  set: (patch: Partial<BoardForm>) => void;
}) {
  const teamKey = useTeamsQuery().data?.find((t) => t.id === form.suggestionTeamId)?.key ?? null;
  const scaffold = useTeamScaffold(form.suggestionsEnabled ? teamKey : null).data;
  const states = (scaffold?.states ?? []).filter((s) => !s.archivedAt);
  const labels = (scaffold?.labels ?? []).filter((l) => !l.retiredAt);

  return (
    <div className="grid gap-4">
      <PortalBoardSwitch
        id="board-suggestions"
        label="Visitors can suggest requests"
        checked={form.suggestionsEnabled}
        onChange={(suggestionsEnabled) => set({ suggestionsEnabled })}
      />
      {form.suggestionsEnabled && (
        <>
          <PortalBoardField
            id="board-suggestion-team"
            label="New suggestions go to"
            error={errors.suggestionTeamId}
          >
            <PortalBoardTeamSelect
              id="board-suggestion-team"
              value={form.suggestionTeamId}
              onChange={(suggestionTeamId) =>
                set({ suggestionTeamId, suggestionStateId: '', suggestionLabelId: '' })
              }
            />
          </PortalBoardField>
          <PortalBoardField
            id="board-suggestion-state"
            label="Status"
            error={errors.suggestionStateId}
          >
            <Select
              value={form.suggestionStateId}
              onValueChange={(suggestionStateId) => set({ suggestionStateId })}
            >
              <SelectTrigger id="board-suggestion-state" className="w-full sm:w-72">
                <SelectValue placeholder="Choose a status" />
              </SelectTrigger>
              <SelectContent>
                {states.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PortalBoardField>
          <PortalBoardField
            id="board-suggestion-label"
            label="Label"
            hint="Your team finds new suggestions by this label."
          >
            <Select
              value={form.suggestionLabelId || DEFAULT_LABEL}
              onValueChange={(v) => set({ suggestionLabelId: v === DEFAULT_LABEL ? '' : v })}
            >
              <SelectTrigger id="board-suggestion-label" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_LABEL}>
                  The team’s Portal label (created if missing)
                </SelectItem>
                {labels.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PortalBoardField>
        </>
      )}
    </div>
  );
}
