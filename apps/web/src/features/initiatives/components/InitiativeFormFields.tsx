'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// The name and short summary of an initiative, in the create and edit dialogs.
// Enter in the name submits.
export default function InitiativeFormFields({
  name,
  description,
  onName,
  onDescription,
  onSubmit,
}: {
  name: string;
  description: string;
  onName: (name: string) => void;
  onDescription: (description: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="initiative-name">Name</Label>
        <Input
          id="initiative-name"
          value={name}
          autoFocus
          placeholder="Expand to Europe"
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSubmit()}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="initiative-description">Summary</Label>
        <Textarea
          id="initiative-description"
          value={description}
          placeholder="What does this initiative achieve?"
          onChange={(e) => onDescription(e.target.value)}
        />
      </div>
    </div>
  );
}
