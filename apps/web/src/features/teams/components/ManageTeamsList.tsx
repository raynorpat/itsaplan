'use client';

import { Lock, LogIn, LogOut, Trash2 } from 'lucide-react';
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
import ManageTeamsRowAction from './ManageTeamsRowAction';

// Every team the user can see: the ones they joined (with Leave, and Delete for a
// team they manage) and the public ones they have not (with Join, unless they are
// a guest).
export default function ManageTeamsList({
  teams,
  isPending,
  canJoin,
  joining,
  onJoin,
  onDelete,
  onLeave,
}: {
  teams: Team[];
  isPending: boolean;
  canJoin: boolean;
  joining: string | null;
  onJoin: (team: Team) => void;
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
      <p className="py-6 text-sm text-muted-foreground">There are no teams you can see yet.</p>
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
          <TableHead className="text-xs font-medium text-muted-foreground">Membership</TableHead>
          <TableHead className="text-xs font-medium text-muted-foreground">Visibility</TableHead>
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
              <span className="text-sm">
                {team.role === 'owner' && 'Team owner'}
                {team.role === 'member' && 'Member'}
                {team.role == null && <span className="text-muted-foreground">Not joined</span>}
              </span>
            </TableCell>
            <TableCell className="px-3 py-3 align-top">
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                {team.visibility === 'private' && <Lock className="size-3.5" />}
                {team.visibility === 'private' ? 'Private' : 'Public'}
              </span>
            </TableCell>
            <TableCell className="px-3 py-2 align-top">
              <div className="flex items-center justify-end gap-1">
                {team.role == null && canJoin && (
                  <ManageTeamsRowAction
                    icon={LogIn}
                    label={joining === team.key ? 'Joining…' : 'Join team'}
                    onClick={() => onJoin(team)}
                  />
                )}
                {team.role != null && (
                  <ManageTeamsRowAction
                    icon={LogOut}
                    label="Leave team"
                    destructive
                    onClick={() => onLeave(team)}
                  />
                )}
                {team.canManage && (
                  <ManageTeamsRowAction
                    icon={Trash2}
                    label="Delete team"
                    destructive
                    onClick={() => onDelete(team)}
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
