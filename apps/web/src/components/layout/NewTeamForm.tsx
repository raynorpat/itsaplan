import { KEY_MAX_LENGTH } from '@/utils/teamKey';
import type { PresetKey } from '@/utils/teamPresets';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import NewTeamPreset from '@/components/layout/NewTeamPreset';

// The create-from-scratch form: the team fields on the left, the issue-type
// preset picker on the right, where the two halves are of comparable size.
export default function NewTeamForm({
  name,
  teamKey,
  description,
  preset,
  onNameChange,
  onKeyChange,
  onDescriptionChange,
  onPresetChange,
}: {
  name: string;
  teamKey: string;
  description: string;
  preset: PresetKey;
  onNameChange: (value: string) => void;
  onKeyChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPresetChange: (value: PresetKey) => void;
}) {
  return (
    <div className="grid gap-6 sm:grid-cols-[1.15fr_1fr]">
      {/* The description field takes the leftover height so both columns end on
          the same line. */}
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
      <NewTeamPreset value={preset} onChange={onPresetChange} />
    </div>
  );
}
