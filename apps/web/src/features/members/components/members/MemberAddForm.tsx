'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAddMember, useMembersQuery, useWorkspaceUsersQuery } from '@/services/members.service';

// Adds a workspace user to the team: the people in the workspace who are not
// members yet and are not suspended. New people are invited from the workspace
// Members page.
export default function MemberAddForm({ teamKey }: { teamKey: string }) {
  const usersQuery = useWorkspaceUsersQuery();
  const membersQuery = useMembersQuery(teamKey);
  const addMember = useAddMember(teamKey);
  const [userId, setUserId] = useState('');

  const memberIds = new Set((membersQuery.data ?? []).map((m) => m.userId));
  const candidates = (usersQuery.data ?? []).filter(
    (u) => !memberIds.has(u.userId) && !u.suspended,
  );

  async function onAdd() {
    if (!userId) return;
    await addMember.mutateAsync(userId);
    setUserId('');
  }

  return (
    <div className="mb-6 flex items-center gap-2">
      <Select value={userId} onValueChange={setUserId} disabled={candidates.length === 0}>
        <SelectTrigger size="sm" className="h-8 w-72 text-sm">
          <SelectValue
            placeholder={candidates.length === 0 ? 'Everyone is a member' : 'Add a person'}
          />
        </SelectTrigger>
        <SelectContent>
          {candidates.map((u) => (
            <SelectItem key={u.userId} value={u.userId}>
              {u.name || u.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" onClick={onAdd} disabled={!userId || addMember.isPending}>
        <UserPlus className="size-4" />
        {addMember.isPending ? 'Adding…' : 'Add'}
      </Button>
    </div>
  );
}
