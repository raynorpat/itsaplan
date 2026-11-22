'use client';

import { LogOut, Trash2 } from 'lucide-react';
import type { Team } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PermissionsPopover } from '@/components/common/permissions/PermissionsPopover';
import ManageTeamsRowAction from './ManageTeamsRowAction';

export default function ManageTeamsList({
  teams,
  isPending,
  onDelete,
  onLeave,
}: {
  teams: Team[];
  isPending: boolean;
  onDelete: (team: Team) => void;
  onLeave: (team: Team) => void;
}) {
  if (isPending) {
    return (
      <div className="space-y-2 py-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">You are not a member of any team yet.</p>
    );
  }

  return (
    <Table className="mt-2 min-w-[640px] table-fixed">
      <colgroup>
        <col className="w-[46%]" />
        <col className="w-[14%]" />
        <col className="w-[28%]" />
        <col className="w-[12%]" />
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-xs font-medium text-muted-foreground">Team</TableHead>
          <TableHead className="text-xs font-medium text-muted-foreground">Role</TableHead>
          <TableHead className="text-xs font-medium text-muted-foreground">Permissions</TableHead>
          <TableHead className="text-right text-xs font-medium text-muted-foreground">
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {teams.map((team) => (
          <TableRow key={team.key} className="group/item">
            <TableCell className="px-3 py-3 align-top">
              <div className="flex min-w-0 items-center gap-2">
                <Badge variant="secondary" className="shrink-0 font-mono">
                  {team.key}
                </Badge>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{team.name}</p>
                  {team.description && (
                    <p className="truncate text-xs text-muted-foreground">{team.description}</p>
                  )}
                </div>
              </div>
            </TableCell>
            <TableCell className="px-3 py-3 align-top">
              <span className="text-sm capitalize">{team.role ?? 'member'}</span>
            </TableCell>
            <TableCell className="px-3 py-3 align-top">
              {team.permissions ? (
                <PermissionsPopover permissions={team.permissions} label="Your permissions" />
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="px-3 py-2 align-top">
              <div className="flex items-center justify-end gap-1">
                {team.role === 'owner' ? (
                  <ManageTeamsRowAction
                    icon={Trash2}
                    label="Delete team"
                    destructive
                    onClick={() => onDelete(team)}
                  />
                ) : (
                  <ManageTeamsRowAction
                    icon={LogOut}
                    label="Leave team"
                    destructive
                    onClick={() => onLeave(team)}
                  />
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
