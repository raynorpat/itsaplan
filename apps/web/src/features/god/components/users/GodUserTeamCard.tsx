'use client';

import type { InstanceUserTeam, PermissionCatalog } from '@/lib/api';
import { formatShortDate } from '@/utils/dates';
import { Badge } from '@/components/ui/badge';
import GodAccessCard from '../GodAccessCard';

// One team the user can reach, as a row in the account panel.
export default function GodUserTeamCard({
  team,
  catalog,
}: {
  team: InstanceUserTeam;
  catalog: PermissionCatalog | undefined;
}) {
  const isOwner = team.role === 'owner';

  return (
    <GodAccessCard
      isOwner={isOwner}
      roleName={team.roleName}
      permissions={team.permissions}
      catalog={catalog}
      header={
        <>
          <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
            {team.teamKey}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{team.teamName}</span>
          <Badge
            variant={isOwner ? 'default' : 'secondary'}
            className="px-1.5 py-0 text-[10px] font-medium"
          >
            {isOwner ? 'Owner' : (team.roleName ?? 'Member')}
          </Badge>
          <span className="text-xs text-muted-foreground">
            joined {formatShortDate(team.joinedAt)}
          </span>
        </>
      }
    />
  );
}
