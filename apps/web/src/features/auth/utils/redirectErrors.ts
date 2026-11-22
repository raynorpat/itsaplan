// Some auth failures reach the sign-in screen as a redirect rather than a rejected
// promise, and carry their reason in ?error=<code> (plus ?error_description=<text>
// when the instance itself refused). Two flows land here: the Google round trip and
// the magic link. Codes raised by better-auth carry no description, so the ones a
// visitor can act on are spelled out here.
const NOT_INVITED =
  'That email has no invite and is not on an approved domain. Ask a workspace admin to invite you.';
const NOT_VERIFIED = 'Google has not verified that address, so it cannot join the workspace.';
const SUSPENDED = 'This account is suspended. Ask a workspace admin to restore it.';
const LINK_REFUSED =
  'This email already has an account whose address is not confirmed. Sign in with an emailed link first, then Google can be used.';

const MESSAGES: Record<string, string> = {
  // The magic link: the instance's own codes on the redirect.
  NOT_INVITED,
  ACCOUNT_SUSPENDED: SUSPENDED,
  INVALID_TOKEN: 'This sign-in link is not valid or has expired. Request a new one below.',
  // The Google round trip: better-auth puts the refusal's message, spaces turned into
  // underscores, in ?error=.
  This_address_has_not_been_invited_to_the_workspace: NOT_INVITED,
  The_address_must_be_verified_to_join_the_workspace: NOT_VERIFIED,
  This_account_is_suspended: SUSPENDED,
  account_not_linked: LINK_REFUSED,
  unable_to_link_account: LINK_REFUSED,
  email_not_found: 'Google did not return an email address for this account.',
};

export function redirectErrorMessage(
  error: string | null,
  description: string | null,
): string | null {
  if (!error) return null;
  return MESSAGES[error] ?? description ?? 'Could not sign in. Please try again.';
}
