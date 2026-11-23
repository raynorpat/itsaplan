'use client';

import Link from 'next/link';
import { usePermissions } from '@/hooks/usePermissions';
import { settingsPath } from '@/utils/paths';
import { Button } from '@/components/ui/button';

// What the cycle pages show for a team with cycles off, with a link to turn them on
// for those who manage the team.
export default function CyclesOffNotice({ teamKey }: { teamKey: string }) {
  const { canManage } = usePermissions();
  return (
    <div className="flex flex-col items-start gap-3 px-6 py-8 text-sm">
      <p className="text-muted-foreground">Cycles are turned off for this team.</p>
      {canManage && (
        <Button asChild size="sm" variant="outline">
          <Link href={settingsPath(teamKey, 'cycles')}>Turn on cycles</Link>
        </Button>
      )}
    </div>
  );
}
