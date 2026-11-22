// Data access for the public invite page: read the invite by its token (no session
// needed) and sign up with the invited email.

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { signUp } from '@/lib/auth-client';

export function useInviteQuery(token: string) {
  return useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.getInvite(token),
    // A bad token is a 404, not a transient failure — do not retry.
    retry: false,
  });
}

// An auth failure during sign-up, carrying better-auth's error code so the form can
// tell an email that already has an account (the invite does not apply to it).
export class InviteAuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'InviteAuthError';
  }
}

// True when a sign-up failed because the email already has an account.
export function isExistingAccountError(err: unknown): boolean {
  return (
    err instanceof InviteAuthError &&
    (err.code === 'USER_ALREADY_EXISTS' || /already\s*exist/i.test(err.message))
  );
}

// Create an account for the invited email. The API applies the invite (its role and
// teams) to the account it creates for that email, so there is no separate accept
// call; autoSignIn (set in @repo/auth) signs the new user in.
export async function registerWithInvite(input: { email: string; password: string }) {
  const result = await signUp.email({
    email: input.email,
    password: input.password,
    name: input.email.split('@')[0] || input.email,
  });
  if (result.error) {
    throw new InviteAuthError(
      result.error.message ?? 'Could not create your account.',
      result.error.code,
    );
  }
}
