'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useIssueQuery } from '@/services/issues.service';
import { issuePath } from '@/utils/paths';

// A bare deep link /issue/:issueId has no team key in the URL. Resolve the
// issue's team (its identifier is "<teamKey>-<number>") and redirect to the
// team-scoped issue route so it opens inside the Shell layout.
export default function IssueRedirect() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params.issueId === 'string' ? params.issueId : null;
  const { data, isLoading } = useIssueQuery(id);

  useEffect(() => {
    if (isLoading) return;
    const teamKey = data ? data.identifier.replace(/-\d+$/, '') : null;
    router.replace(teamKey && data ? issuePath(teamKey, data.sequenceNumber) : '/');
  }, [data, isLoading, router]);

  return (
    <div className="flex h-svh items-center justify-center bg-background text-sm text-muted-foreground">
      Loading…
    </div>
  );
}
