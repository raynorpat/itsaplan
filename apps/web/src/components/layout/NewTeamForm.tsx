import { KEY_MAX_LENGTH } from '@/utils/teamKey';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// The create-team form: name, key and description.
export default function NewTeamForm({
  name,
  teamKey,
  description,
  onNameChange,
  onKeyChange,
  onDescriptionChange,
}: {
  name: string;
  teamKey: string;
  description: string;
  onNameChange: (value: string) => void;
  onKeyChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label>Name</Label>
        <Input autoFocus value={name} onChange={(e) => onNameChange(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Key (short, e.g. MKT)</Label>
        <Input
          value={teamKey}
          onChange={(e) => onKeyChange(e.target.value)}
          maxLength={KEY_MAX_LENGTH}
        />
      </div>
      <div className="flex flex-1 flex-col space-y-1.5">
        <Label>Description</Label>
        <Textarea
          rows={2}
          className="min-h-20 flex-1 resize-none"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
      </div>
    </div>
  );
}
