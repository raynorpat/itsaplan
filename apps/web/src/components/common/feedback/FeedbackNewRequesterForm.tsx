'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateRequester } from '@/services/feedback.service';
import type { FeedbackRequester } from '@/utils/feedback';

// Creates the person who gave the feedback: a name and an optional email. An email
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
  const create = useCreateRequester();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        create.mutate({ name: name.trim(), email: email.trim() || null }, { onSuccess: onCreated });
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
