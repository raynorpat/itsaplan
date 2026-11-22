'use client';

import type { InstanceTeamMember } from '@/lib/api';
import { formatShortDate } from '@/utils/dates';
import Avatar from '@/components/common/Avatar';
import { Badge } from '@/components/ui/badge';

// One member of the team, as a row in the team panel.
export default function GodTeamMemberCard({ member }: { member: InstanceTeamMember }) {
  const isOwner = member.role === 'owner';

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <Avatar
        name={member.name || member.email}
        image={member.image}
        className="size-6 shrink-0 text-[10px]"
      />
      <span className="min-w-0 flex-1 truncate text-sm">{member.name || member.email}</span>
      <Badge
        variant={isOwner ? 'default' : 'secondary'}
        className="px-1.5 py-0 text-[10px] font-medium"
      >
        {isOwner ? 'Team owner' : 'Member'}
      </Badge>
      <span className="text-xs text-muted-foreground">
        joined {formatShortDate(member.joinedAt)}
      </span>
    </div>
  );
}
