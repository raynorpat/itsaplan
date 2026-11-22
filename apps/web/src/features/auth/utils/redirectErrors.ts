// Some auth failures reach the sign-in screen as a redirect rather than a rejected
// promise, and carry their reason in ?error=<code> (plus ?error_description=<text>
// when the instance itself refused). Two flows land here: the Google round trip and
// the magic link. Codes raised by better-auth carry no description, so the ones a
// visitor can act on are spelled out here.
const MESSAGES: Record<string, string> = {
  signup_disabled: 'This workspace is not accepting new accounts for that email.',
  NOT_INVITED:
    'That email has no invite and is not on an approved domain. Ask a workspace admin to invite you.',
  email_not_found: 'Google did not return an email address for this account.',
  // The magic link failed. better-auth redirects with these uppercase codes.
  EXPIRED_TOKEN: 'This sign-in link has expired. Request a new one below.',
  INVALID_TOKEN: 'This sign-in link is not valid. Request a new one below.',
};

export function redirectErrorMessage(
  error: string | null,
  description: string | null,
): string | null {
  if (!error) return null;
  return MESSAGES[error] ?? description ?? 'Could not sign in. Please try again.';
}
