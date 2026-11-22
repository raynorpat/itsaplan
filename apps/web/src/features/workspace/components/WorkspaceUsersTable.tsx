'use client';

import type { WorkspaceRole } from '@/lib/api';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useWorkspaceUsersQuery } from '@/services/members.service';
import WorkspaceUserRow from './WorkspaceUserRow';

// Everyone in the workspace, with their role and whether they are suspended.
export default function WorkspaceUsersTable({
  viewerRole,
  viewerId,
}: {
  viewerRole: WorkspaceRole;
  viewerId: string | null;
}) {
  const usersQuery = useWorkspaceUsersQuery();
  if (usersQuery.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <Table className="min-w-[640px] table-fixed">
      <colgroup>
        <col className="w-[60%]" />
        <col className="w-[20%]" />
        <col className="w-[20%]" />
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-xs font-medium text-muted-foreground">Person</TableHead>
          <TableHead className="text-xs font-medium text-muted-foreground">Role</TableHead>
          <TableHead className="text-right text-xs font-medium text-muted-foreground">
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(usersQuery.data ?? []).map((u) => (
          <WorkspaceUserRow
            key={u.userId}
            user={u}
            viewerRole={viewerRole}
            self={u.userId === viewerId}
          />
        ))}
      </TableBody>
    </Table>
  );
}
