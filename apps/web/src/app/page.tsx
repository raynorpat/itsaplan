'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, SquareKanban } from 'lucide-react';
import { useTeamsQuery } from '@/services/teams.service';
import { useAccountPreferencesQuery } from '@/services/preferences.service';
import { startPagePath, teamPath } from '@/utils/paths';
import NewTeamModal from '@/components/layout/NewTeamModal';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

// The index route: reopen the last-used team if it still exists, otherwise the
// first team, on the section the user picked as their start page. Waits for both
// the team list and the preferences before deciding so it does not flash the
// wrong destination. With no teams at all, offers to create the first one.
export default function Home() {
  const router = useRouter();
  const { data: teams } = useTeamsQuery();
  const { data: prefs, isPending: prefsPending } = useAccountPreferencesQuery();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (teams == null || teams.length === 0 || prefsPending) return;
    // The remembered team only counts while the user can still see it; otherwise
    // the first joined team, else the first visible one.
    const last = teams.find((p) => p.id === prefs?.lastTeamId);
    const target = last?.key ?? (teams.find((p) => p.role != null) ?? teams[0])?.key;
    if (target) router.replace(startPagePath(target, prefs?.startPage ?? 'work-items'));
  }, [teams, prefs, prefsPending, router]);

  // No teams yet: the Shell (which owns the New team modal) never mounts
  // without a team, so the empty state offers team creation directly.
  if (teams && teams.length === 0) {
    return (
      <div className="flex h-svh items-center justify-center p-6">
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SquareKanban />
            </EmptyMedia>
            <EmptyTitle>No teams yet</EmptyTitle>
            <EmptyDescription>
              Create your first team to start planning issues on a board.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreating(true)}>
              <Plus />
              Create team
            </Button>
          </EmptyContent>
        </Empty>

        {creating && (
          <NewTeamModal
            onClose={() => setCreating(false)}
            onCreated={(key) => {
              setCreating(false);
              router.push(teamPath(key));
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-svh items-center justify-center bg-background text-sm text-muted-foreground">
      Loading…
    </div>
  );
}
