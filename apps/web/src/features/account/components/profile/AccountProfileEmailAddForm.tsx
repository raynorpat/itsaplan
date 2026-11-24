'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAddEmailAddress } from '../../services/emailAddresses.service';

// Adds an extra address; the API mails it a confirmation link.
export default function AccountProfileEmailAddForm({ disabled }: { disabled?: boolean }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useAddEmailAddress();
  const trimmed = email.trim();

  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed) return;
        setError(null);
        add.mutate(trimmed, {
          onSuccess: () => {
            toast.success(`Confirmation link sent to ${trimmed}`);
            setEmail('');
          },
          onError: (err) => setError(err instanceof Error ? err.message : 'Could not add it.'),
        });
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-label="Email address to add"
          className="max-w-sm"
          disabled={disabled}
        />
        <Button type="submit" size="sm" disabled={disabled || !trimmed || add.isPending}>
          {add.isPending ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
