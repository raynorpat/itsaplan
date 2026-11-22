'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, UserMinus } from 'lucide-react';
import { type MemberRow } from '@/lib/api';
import { formatShortDate } from '@/utils/dates';
import Avatar from '@/components/common/Avatar';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useMembersQuery,
  useRemoveMember,
  useWorkspaceUsersQuery,
} from '@/services/members.service';
import { usePermissions } from '@/hooks/usePermissions';
import { useSession } from '@/lib/auth-client';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABELS } from '@/utils/workspaceRoles';
import MemberRoleControl from './MemberRoleControl';
import MemberDescription from './MemberDescription';
import MemberDescriptionDialog from './MemberDescriptionDialog';

// The team's members, one row per person, each with their workspace role. A team
// manager makes team owners and removes anyone; a member can leave (remove
// themselves). Guests cannot list workspace users, so they see no workspace roles.
export default function MembersList({ teamKey }: { teamKey: string }) {
  const membersQuery = useMembersQuery(teamKey);
  const { canManage, workspaceRole } = usePermissions();
  const { data: session } = useSession();
  const currentUserId = session?.user.id ?? null;
  const removeMember = useRemoveMember(teamKey);
  const usersQuery = useWorkspaceUsersQuery(workspaceRole != null && workspaceRole !== 'guest');
  const router = useRouter();
  const [target, setTarget] = useState<MemberRow | null>(null);

  const members = membersQuery.data ?? [];
  const roleOf = new Map((usersQuery.data ?? []).map((u) => [u.userId, u.role]));

  if (membersQuery.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const targetIsSelf = target?.userId === currentUserId;

  async function confirmRemove() {
    if (!target) return;
    await removeMember.mutateAsync(target.userId);
    setTarget(null);
    // Leaving the team revokes your own access; return to the app root, which
    // reopens a team you still belong to.
    if (targetIsSelf) {
      router.push('/');
      router.refresh();
    }
  }

  return (
    <div className="mb-8 space-y-4">
      <Table className="min-w-[720px] table-fixed">
        <colgroup>
          <col className="w-[50%]" />
          <col className="w-[22%]" />
          <col className="w-[28%]" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-xs font-medium text-muted-foreground">Member</TableHead>
            <TableHead className="text-xs font-medium text-muted-foreground">Role</TableHead>
            <TableHead className="text-right text-xs font-medium text-muted-foreground">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            const self = m.userId === currentUserId;
            const canRemove = self || canManage;
            const canEditDescription = canManage || self;
            const workspace = roleOf.get(m.userId);
            const removeLabel = self ? 'Leave team' : 'Remove from team';
            return (
              <TableRow key={m.userId} className="group/item">
                <TableCell className="px-3 py-3 align-top whitespace-normal">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Avatar
                      name={m.name || m.email}
                      image={m.image}
                      className="size-8 shrink-0 text-[11px]"
                    />
                    <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{m.name || m.email}</span>
                        {self && (
                          <span className="text-xs font-normal text-muted-foreground">(you)</span>
                        )}
                        {workspace && workspace !== 'member' && (
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                            {ROLE_LABELS[workspace]}
                          </Badge>
                        )}
                      </span>
                      <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        <span className="truncate">{m.email}</span>
                        <span>· joined {formatShortDate(m.createdAt)}</span>
                      </span>
                      <MemberDescription member={m} />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="px-3 pt-4 pb-3 align-top whitespace-normal">
                  <MemberRoleControl teamKey={teamKey} member={m} canManage={canManage} />
                </TableCell>
                <TableCell className="px-3 pt-3 pb-2 align-top">
                  <div className="flex items-center justify-end gap-1">
                    {canEditDescription && (
                      <MemberDescriptionDialog teamKey={teamKey} member={m} self={self} />
                    )}
                    {canRemove && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            aria-label={removeLabel}
                            onClick={() => setTarget(m)}
                          >
                            {self ? (
                              <LogOut className="size-4" />
                            ) : (
                              <UserMinus className="size-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{removeLabel}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {target && (
        <ConfirmDialog
          title={
            targetIsSelf ? 'Leave this team' : `Remove ${target.name || target.email} from the team`
          }
          confirmLabel={targetIsSelf ? 'Leave team' : 'Remove'}
          onConfirm={confirmRemove}
          onClose={() => setTarget(null)}
        >
          <div className="text-sm text-muted-foreground">
            {targetIsSelf
              ? 'The team leaves your sidebar. A private team and its issues are no longer visible to you.'
              : `${target.name || target.email} is no longer a member. They can be added back later.`}
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
