'use client';

import type { InstanceUserTeam } from '@/lib/api';
import { formatShortDate } from '@/utils/dates';
import { Badge } from '@/components/ui/badge';

// One team the user is a member of, as a row in the account panel.
export default function GodUserTeamCard({ team }: { team: InstanceUserTeam }) {
  const isOwner = team.role === 'owner';

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
        {team.teamKey}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{team.teamName}</span>
      <Badge
        variant={isOwner ? 'default' : 'secondary'}
        className="px-1.5 py-0 text-[10px] font-medium"
      >
        {isOwner ? 'Team owner' : 'Member'}
      </Badge>
      <span className="text-xs text-muted-foreground">joined {formatShortDate(team.joinedAt)}</span>
    </div>
  );
}
