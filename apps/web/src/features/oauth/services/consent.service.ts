'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import { consentBody, type InstallSelection } from '../utils/consent';

// The application a consent page shows (/api/auth/instance/oauth-client).
// `application` is false for a client an MCP client registered itself.
export interface ConsentClient {
  clientId: string;
  name: string;
  description: string | null;
  developer: string | null;
  developerUrl: string | null;
  iconUrl: string | null;
  application: boolean;
}

export function useConsentClient(clientId: string | null) {
  return useQuery({
    queryKey: qk.oauthClient(clientId ?? ''),
    queryFn: () =>
      instanceFetch<ConsentClient>(
        `/instance/oauth-client?clientId=${encodeURIComponent(clientId!)}`,
      ),
    enabled: !!clientId,
    retry: false,
  });
}

// The OAuth provider answers the consent and the resume with where the browser goes
// next: the application's redirect URI (with a code or an error) or the next step
// (the consent page). A fetch gets it as `{ redirect: true, url }`.
interface RedirectAnswer {
  url?: string;
  redirect_uri?: string;
}

export function followRedirect(answer: RedirectAnswer): void {
  const target = answer.url ?? answer.redirect_uri;
  if (!target) throw new Error('The authorization could not continue.');
  window.location.assign(target);
}

export function useConsent() {
  return useMutation({
    mutationFn: (input: { accept: boolean; oauthQuery: string; install?: InstallSelection }) =>
      instanceFetch<RedirectAnswer>('/oauth2/consent', {
        method: 'POST',
        body: consentBody(input),
      }),
    onSuccess: followRedirect,
  });
}

// Resumes an authorization after a sign-in that started from it: the provider runs
// the authorization again with the new session and answers with the consent page or
// the application's redirect URI.
export function resumeAuthorization(oauthQuery: string): Promise<RedirectAnswer> {
  return instanceFetch<RedirectAnswer>('/oauth2/continue', {
    method: 'POST',
    body: { selected: true, oauth_query: oauthQuery },
  });
}
