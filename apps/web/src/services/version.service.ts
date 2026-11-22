'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';

// The running version, shown in the sidebar footer to every signed-in user.
export function useAppVersionQuery() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: qk.appVersion,
    queryFn: () => api.getAppVersion(),
    // The route needs a session; the login and invite screens have none.
    enabled: Boolean(session),
    // Fixed for the life of the process: it only changes when the instance restarts
    // on a new build, which reloads the page anyway.
    staleTime: Infinity,
  });
}
