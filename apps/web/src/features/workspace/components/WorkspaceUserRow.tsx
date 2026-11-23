'use client';

import { Ban, RotateCcw } from 'lucide-react';
import type { WorkspaceRole, WorkspaceUser } from '@/lib/api';
import { formatShortDate } from '@/utils/dates';
import { assignableRoles, atLeast, ROLE_LABELS } from '@/utils/workspaceRoles';
import Avatar from '@/components/common/Avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TableCell, TableRow } from '@/components/ui/table';
import { useSetSuspended, useSetWorkspaceRole } from '../services/workspace.service';

// One workspace user. Owners change anyone's role and suspend anyone; admins do so
// for members and guests (up to admin). Nobody acts on themselves here; the API
// also keeps at least one owner.
export default function WorkspaceUserRow({
  user,
  viewerRole,
  self,
}: {
  user: WorkspaceUser;
  viewerRole: WorkspaceRole;
  self: boolean;
}) {
  const setRole = useSetWorkspaceRole();
  const setSuspended = useSetSuspended();
  const roles = self ? [] : assignableRoles(viewerRole, user.role);
  const canSuspend =
    !self && (viewerRole === 'owner' || (viewerRole === 'admin' && !atLeast(user.role, 'admin')));
  const suspended = user.suspended;

  return (
    <TableRow className="group/item">
      <TableCell className="px-3 py-3 align-top whitespace-normal">
        <div className="flex min-w-0 items-start gap-2.5">
          <Avatar
            name={user.name || user.email}
            image={user.image}
            className="size-8 shrink-0 text-[11px]"
          />
          <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="truncate">{user.name || user.email}</span>
              {self && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
              {suspended && (
                <Badge variant="destructive" className="px-1.5 py-0 text-[10px] font-normal">
                  Suspended
                </Badge>
              )}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {user.email} · joined {formatShortDate(user.createdAt)}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className="px-3 pt-4 pb-3 align-top">
        {roles.length > 0 ? (
          <Select
            value={user.role}
            disabled={setRole.isPending}
            onValueChange={(role) =>
              role !== user.role &&
              setRole.mutate({ userId: user.userId, role: role as WorkspaceRole })
            }
          >
            <SelectTrigger size="sm" className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
            {ROLE_LABELS[user.role]}
          </Badge>
        )}
      </TableCell>
      <TableCell className="px-3 pt-3 pb-2 text-right align-top">
        {canSuspend && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={setSuspended.isPending}
            onClick={() => setSuspended.mutate({ userId: user.userId, suspended: !suspended })}
          >
            {suspended ? <RotateCcw className="size-4" /> : <Ban className="size-4" />}
            {suspended ? 'Unsuspend' : 'Suspend'}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
