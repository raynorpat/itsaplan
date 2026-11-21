'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { TeamFeatures } from '@/lib/api';
import { settingsPath } from '@/utils/paths';
import { FEATURE_LABEL } from '@/utils/teamFeatures';
import { usePermissions } from '@/hooks/usePermissions';
import { useTeamFeatures } from '@/hooks/useTeamFeatures';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/page/EmptyState';

// Gates a section that an owner can turn off for the team (Settings ->
// General). With the feature on it renders the section; with it off it explains
// where to turn it back on, and offers the link to an owner. Reaching a disabled
// section takes a typed URL — its navigation entries are hidden.
export default function RequireFeature({
  feature,
  children,
}: {
  feature: keyof TeamFeatures;
  children: ReactNode;
}) {
  const features = useTeamFeatures();
  const { isOwner } = usePermissions();
  const params = useParams<{ teamKey: string }>();

  if (features[feature]) return <>{children}</>;

  return (
    <EmptyState
      title={`${FEATURE_LABEL[feature]} are turned off`}
      description="An owner can turn this section back on in General settings."
    >
      {isOwner && params.teamKey && (
        <Button size="sm" asChild>
          <Link href={settingsPath(params.teamKey, 'general')}>Open General settings</Link>
        </Button>
      )}
    </EmptyState>
  );
}
