'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useAuthConfig } from '@/services/authConfig.service';
import {
  isExistingAccountError,
  registerWithInvite,
  signOutUnconfirmed,
} from '../services/invite.service';

// Sign-up for the invitee. The email is fixed to the invited address: the account
// created for it takes the invite's role and teams. An email that already has an
// account is already in the workspace, so it is sent to the sign-in page. When the
// instance requires email confirmation, the session sign-up opens is dropped and the
// invitee is asked to open the emailed link, as on the normal sign-up page.
export default function InviteAuthForm({ email, token }: { email: string; token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  const [pending, setPending] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const needsConfirmation = useAuthConfig()?.requireEmailVerification === true;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      await registerWithInvite({ email, password, token });
      if (needsConfirmation) {
        await signOutUnconfirmed();
        setAwaitingConfirmation(true);
        setPending(false);
        return;
      }
      router.push('/');
      router.refresh();
    } catch (err) {
      if (isExistingAccountError(err)) setExisting(true);
      else setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setPending(false);
    }
  }

  if (awaitingConfirmation) {
    return (
      <div className="flex flex-col gap-4 text-sm text-muted-foreground">
        <p>
          We sent a link to <span className="font-medium text-foreground">{email}</span>. Open it to
          finish creating your account.
        </p>
        <Button asChild variant="outline">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  if (existing) {
    return (
      <div className="flex flex-col gap-4 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">{email}</span> already has an account in
          this workspace. Sign in with it instead.
        </p>
        <Button asChild variant="outline">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
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

        <Field>
          <FieldLabel htmlFor="invite-password">Password</FieldLabel>
          <Input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
          />
          <FieldDescription>Must be at least 8 characters long.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="invite-confirm">Confirm password</FieldLabel>
          <Input
            id="invite-confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={pending}
          />
        </Field>

        {error && <FieldError>{error}</FieldError>}

        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? 'Creating account…' : 'Create account & join'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}
