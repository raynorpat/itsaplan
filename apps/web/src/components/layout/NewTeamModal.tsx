import { useState } from 'react';
import { useCreateTeam } from '@/services/teams.service';
import { normalizeKey, suggestKey } from '@/utils/teamKey';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import NewTeamForm from '@/components/layout/NewTeamForm';

// Creates a team.
export default function NewTeamModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (teamKey: string) => void;
}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // Once the user edits the key, stop deriving it from the name. Clearing the
  // key field resumes auto-generation.
  const [keyEdited, setKeyEdited] = useState(false);
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
    };
    createTeam.mutate({ input }, { onSuccess: (team) => onCreated(team.key) });
  }

  return (
    <Modal title="New team" onClose={onClose}>
      <div className="space-y-4">
        {/* On a short viewport the form scrolls on its own so the submit button
            stays in place instead of sitting below the fold. */}
        <div className="max-h-[55vh] overflow-y-auto pr-1">
          <NewTeamForm
            name={name}
            teamKey={key}
            description={description}
            onNameChange={onNameChange}
            onKeyChange={onKeyChange}
            onDescriptionChange={setDescription}
          />
        </div>
        <Button
          className="w-full"
          disabled={createTeam.isPending || !key.trim() || !name.trim()}
          onClick={submit}
        >
          Create team
        </Button>
      </div>
    </Modal>
  );
}
