'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import AuthFormHeader from '../AuthFormHeader';
import AuthLoginAlternatives from './AuthLoginAlternatives';
import AuthMessagePanel from '../AuthMessagePanel';
import { sendMagicLink, signInWithGoogle, signInWithPasskey } from '@/services/signIn.service';
import { useAuthAction } from '../../hooks/useAuthAction';
import { redirectErrorMessage } from '../../utils/redirectErrors';

// Sign-in and sign-up in one: the visitor enters an email and gets a link. The link
// signs in an existing account, or creates one when the address may join (an invite
// or an approved domain). Google and passkeys are offered next to it.
export default function AuthLoginForm() {
  const [email, setEmail] = useState('');
  // The address a link went to. Set on success, and it replaces the form: there is
  // nothing left to do on this screen until the inbox is opened.
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const { error, pending, run } = useAuthAction();
  const params = useSearchParams();
  // A Google sign-in or a link that could not complete comes back here as a redirect
  // rather than as a rejected promise, so its reason arrives in the query string.
  const redirectError = redirectErrorMessage(params.get('error'), params.get('error_description'));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    run(
      async () => {
        await sendMagicLink(email);
        setLinkSentTo(email);
      },
      { redirect: false },
    );
  }

  if (linkSentTo) {
    return (
      <AuthMessagePanel
        title="Check your email"
        description={`If ${linkSentTo} can sign in to this workspace, we sent it a link. Open it to continue.`}
        footer={
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => setLinkSentTo(null)}
          >
            Use another email
          </button>
        }
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="p-6 md:p-8">
      <FieldGroup>
        <AuthFormHeader title="Welcome" description="We will email you a link that signs you in" />

        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            placeholder="m@example.com"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
          />
          <FieldDescription>
            New here? The link creates your account if you were invited or your email is on one of
            the workspace&apos;s approved domains.
          </FieldDescription>
        </Field>

        {(error || redirectError) && <FieldError>{error ?? redirectError}</FieldError>}

        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Email me a sign-in link'}
          </Button>
        </Field>

        <FieldSeparator>Or</FieldSeparator>

        <AuthLoginAlternatives
          pending={pending}
          onGoogle={() => run(signInWithGoogle, { redirect: false })}
          onPasskey={() => run(signInWithPasskey)}
        />
      </FieldGroup>
    </form>
  );
}
