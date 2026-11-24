'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import { membersPath } from '@/utils/paths';

// /settings/teams/:key opens the first settings section the viewer may read, or the
// team's members when they may read none.
export default function TeamSettingsIndexPage() {
  const router = useRouter();
  const params = useParams();
  const teamKey = typeof params.teamKey === 'string' ? decodeURIComponent(params.teamKey) : null;
  const { firstHref } = useSettingsNavGroups(teamKey);

  useEffect(() => {
    if (!teamKey) return;
    router.replace(firstHref ?? membersPath(teamKey));
  }, [router, teamKey, firstHref]);

  return null;
}
