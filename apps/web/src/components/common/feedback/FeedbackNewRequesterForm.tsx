'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateRequester } from '@/services/feedback.service';
import type { FeedbackRequester } from '@/utils/feedback';

// Creates the person who gave the feedback: a name, an optional email and "Keep this
// person updated" (off: the team logged them, they never asked for email). An email
// that already belongs to someone returns that person (the API's rule).
export default function FeedbackNewRequesterForm({
  initialName,
  onCreated,
  onBack,
}: {
  initialName: string;
  onCreated: (requester: FeedbackRequester) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState('');
  const [keepUpdated, setKeepUpdated] = useState(false);
  const create = useCreateRequester();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const address = email.trim() || null;
        create.mutate(
          { name: name.trim(), email: address, keepUpdated: keepUpdated && address != null },
          {
            onSuccess: ({ requester, updatesRefused }) => {
              if (updatesRefused) toast('This person unsubscribed; updates stay off');
              onCreated(requester);
            },
          },
        );
      }}
    >
      <Input
        autoFocus
        aria-label="Name"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        aria-label="Email (optional)"
        type="email"
        placeholder="Email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id="new-requester-updates"
          checked={keepUpdated && email.trim() !== ''}
          disabled={email.trim() === ''}
          onCheckedChange={(checked) => setKeepUpdated(checked === true)}
        />
        <Label htmlFor="new-requester-updates" className="text-sm font-normal">
          Keep this person updated by email
        </Label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" size="sm" disabled={!name.trim() || create.isPending}>
          Add person
        </Button>
      </div>
    </form>
  );
}
