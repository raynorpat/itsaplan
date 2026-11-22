'use client';

import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import GoogleIcon from '@/components/common/GoogleIcon';
import { useAuthConfig } from '@/services/authConfig.service';

// The sign-in methods besides the emailed link: Google and passkeys, each shown when
// the workspace offers it.
export default function AuthLoginAlternatives({
  pending,
  onGoogle,
  onPasskey,
}: {
  pending: boolean;
  onGoogle: () => void;
  onPasskey: () => void;
}) {
  const authConfig = useAuthConfig();

  // One Field for all of them so they sit together as a group — a Field each would
  // space them like separate form questions.
  return (
    <Field className="gap-2">
      {authConfig?.google && (
        <Button type="button" variant="outline" onClick={onGoogle} disabled={pending}>
          <GoogleIcon className="size-4" />
          Continue with Google
        </Button>
      )}
      {authConfig?.passkey !== false && (
        <Button type="button" variant="outline" onClick={onPasskey} disabled={pending}>
          <KeyRound />
          Sign in with passkey
        </Button>
      )}
    </Field>
  );
}
