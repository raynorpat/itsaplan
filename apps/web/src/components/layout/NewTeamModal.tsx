import { useState } from 'react';
import { type Team } from '@/lib/api';
import { useCreateTeam } from '@/services/teams.service';
import { normalizeKey, suggestKey } from '@/utils/teamKey';
import type { PresetKey } from '@/utils/teamPresets';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import CopyTeamForm from '@/components/layout/CopyTeamForm';
import NewTeamForm from '@/components/layout/NewTeamForm';
import { allSelected, type CopyInclude } from '@/components/layout/CopyTeamOptions';

// Creates a team, or — when `copyFrom` is set — copies that team's structure
// (states, issue types, labels, custom fields) into a new team without its
// issues.
export default function NewTeamModal({
  onClose,
  onCreated,
  copyFrom,
}: {
  onClose: () => void;
  onCreated: (teamKey: string) => void;
  copyFrom?: Team;
}) {
  const initialName = copyFrom ? `${copyFrom.name} copy` : '';
  const [key, setKey] = useState(() => suggestKey(initialName));
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(copyFrom?.description ?? '');
  // Once the user edits the key, stop deriving it from the name. Clearing the
  // key field resumes auto-generation.
  const [keyEdited, setKeyEdited] = useState(false);
  // Which parts of the source team to copy. Defaults to everything; the user
  // clears what they don't want.
  const [include, setInclude] = useState<CopyInclude>(allSelected);
  // Which issue types the new team starts with. A copy takes its types from the
  // source team, so the preset applies only when creating from scratch.
  const [preset, setPreset] = useState<PresetKey>('general');
  const createTeam = useCreateTeam();

  function onNameChange(value: string) {
    setName(value);
    if (!keyEdited) setKey(suggestKey(value));
  }

  function onKeyChange(value: string) {
    const next = normalizeKey(value);
    setKey(next);
    setKeyEdited(next !== '');
  }

  function submit() {
    const input = {
      key: key.trim().toUpperCase(),
      name: name.trim(),
      description: description.trim(),
      ...(copyFrom ? { include } : { preset }),
    };
    createTeam.mutate(
      { copyFromKey: copyFrom?.key, input },
      { onSuccess: (team) => onCreated(team.key) },
    );
  }

  return (
    <Modal
      title={copyFrom ? `Copy team "${copyFrom.name}"` : 'New team'}
      onClose={onClose}
      wide="xl"
    >
      <div className="space-y-4">
        {/* On a short viewport the form scrolls on its own so the submit button
            stays in place instead of sitting below the fold. */}
        <div className="max-h-[55vh] overflow-y-auto pr-1">
          {copyFrom ? (
            <CopyTeamForm
              name={name}
              teamKey={key}
              description={description}
              include={include}
              onNameChange={onNameChange}
              onKeyChange={onKeyChange}
              onDescriptionChange={setDescription}
              onIncludeChange={setInclude}
            />
          ) : (
            <NewTeamForm
              name={name}
              teamKey={key}
              description={description}
              preset={preset}
              onNameChange={onNameChange}
              onKeyChange={onKeyChange}
              onDescriptionChange={setDescription}
              onPresetChange={setPreset}
            />
          )}
        </div>
        <Button
          className="w-full"
          disabled={createTeam.isPending || !key.trim() || !name.trim()}
          onClick={submit}
        >
          {copyFrom ? 'Copy team' : 'Create team'}
        </Button>
      </div>
    </Modal>
  );
}
