// Data access for the public invite page: read the invite by its token (no session
// needed). Joining happens through the normal sign-in: the account created for the
// invited email (by its magic link or Google) takes the invite's role and teams.

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useInviteQuery(token: string) {
  return useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.getInvite(token),
    // A bad token is a 404, not a transient failure — do not retry.
    retry: false,
  });
}
