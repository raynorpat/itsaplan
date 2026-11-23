'use client';

import type { MemberRole, MemberRow } from '@/types/team';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSetMemberRole } from '@/services/members.service';

// A member's place in the team: a team owner or a member. A team manager gets a
// select to change it; anyone else sees a badge.
export default function MemberRoleControl({
  teamKey,
  member,
  canManage,
}: {
  teamKey: string;
  member: MemberRow;
  canManage: boolean;
}) {
  const setMemberRole = useSetMemberRole(teamKey);
  const isOwnerRow = member.role === 'owner';

  if (!canManage) {
    return (
      <Badge
        variant={isOwnerRow ? 'secondary' : 'outline'}
        className="px-1.5 py-0 text-[10px] font-normal"
      >
        {isOwnerRow ? 'Team owner' : 'Member'}
      </Badge>
    );
  }

  function onValueChange(next: string) {
    if (next === member.role) return;
    setMemberRole.mutate({ userId: member.userId, role: next as MemberRole });
  }

  return (
    <Select value={member.role} disabled={setMemberRole.isPending} onValueChange={onValueChange}>
      <SelectTrigger size="sm" className="h-7 w-36 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="member">Member</SelectItem>
        <SelectItem value="owner">Team owner</SelectItem>
      </SelectContent>
    </Select>
  );
}
