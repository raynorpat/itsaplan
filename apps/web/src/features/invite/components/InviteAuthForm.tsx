'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import GoogleIcon from '@/components/common/GoogleIcon';
import { useAuthConfig } from '@/services/authConfig.service';
import { sendMagicLink, signInWithGoogle } from '@/services/signIn.service';

// Joining for the invitee. The email is fixed to the invited address: the account
// created for it, through its emailed link or Google with the same address, takes the
// invite's role and teams. An address that already has an account just signs in.
export default function InviteAuthForm({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const google = useAuthConfig()?.google === true;

  async function run(action: () => Promise<void>) {
    setError(null);
    setPending(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await sendMagicLink(email);
      setSent(true);
    });
  }

  if (sent) {
    return (
      <p className="text-sm text-muted-foreground">
        We sent a link to <span className="font-medium text-foreground">{email}</span>. Open it to
        join.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="invite-email">Email</FieldLabel>
          <Input id="invite-email" type="email" value={email} readOnly disabled />
          <FieldDescription>The invite is tied to this email.</FieldDescription>
        </Field>

        {error && <FieldError>{error}</FieldError>}

        <Field className="gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Email me a link to join'}
          </Button>
          {google && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void run(signInWithGoogle)}
            >
              <GoogleIcon className="size-4" />
              Join with Google
            </Button>
          )}
        </Field>
      </FieldGroup>
    </form>
  );
}
