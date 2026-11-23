'use client';

import { useQuery } from '@tanstack/react-query';
import { type PublicAuthConfig } from '@/lib/api';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';

// Which sign-in methods the instance offers: the emailed link, Google and passkeys.
// Shared rather than feature-local: the sign-in and invite pages read it before there
// is a session, and the account page reads it to decide which providers to list.

export function useAuthConfigQuery() {
  return useQuery({
    queryKey: qk.authConfig,
    queryFn: () => instanceFetch<PublicAuthConfig>('/instance/sign-in-options'),
    // Changes only with the environment or an admin's settings, and is read on
    // several screens, so keep it out of the refetch path.
    staleTime: 5 * 60_000,
  });
}

// The config to render with, or null while the request is in flight or after it
// failed — the API is the real gate, so the screens stay usable meanwhile.
export function useAuthConfig(): PublicAuthConfig | null {
  return useAuthConfigQuery().data ?? null;
}
