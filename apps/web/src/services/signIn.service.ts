'use client';

import { signIn } from '@/lib/auth-client';

// Where a link in an email lands the reader. The auth handler runs on the API
// origin, so every link it builds needs the web origin passed in explicitly —
// without it better-auth sends the reader back to the API, which renders nothing.
const appUrl = (path: string) =>
  typeof window === 'undefined' ? path : `${window.location.origin}${path}`;

const GENERIC_ERROR = 'Something went wrong. Please try again.';

// Sends a one-time sign-in link. It also creates the account the first time the link
// is used, when the address may join (an invite or an approved domain). The API
// answers the same whether or not a link was sent, so this never reveals who may
// sign in.
// `next` is where the link lands after signing in: the app's home, or the page that
// resumes an OAuth authorization the sign-in started from.
export async function sendMagicLink(email: string, next = '/'): Promise<void> {
  const result = await signIn.magicLink({
    email,
    callbackURL: appUrl(next),
    newUserCallbackURL: appUrl(next),
    errorCallbackURL: appUrl('/login'),
  });
  if (result.error) throw new Error(result.error.message ?? GENERIC_ERROR);
}

// Starts the Google round trip. Unlike the other calls here this one navigates away:
// better-auth redirects to Google, and Google comes back to the API callback, which
// sends the browser to one of these two URLs (both on the web origin). A new address
// gets an account when it may join.
export async function signInWithGoogle(next = '/'): Promise<void> {
  const result = await signIn.social({
    provider: 'google',
    callbackURL: appUrl(next),
    errorCallbackURL: appUrl('/login'),
  });
  if (result.error) throw new Error(result.error.message ?? GENERIC_ERROR);
}

export async function signInWithPasskey(): Promise<void> {
  const result = await signIn.passkey();
  if (result?.error)
    throw new Error(
      result.error.message ?? 'Could not sign in with your passkey. Please try again.',
    );
}
