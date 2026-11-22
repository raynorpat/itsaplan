'use client';

import { useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';
import type { InviteRole, WorkspaceRole } from '@/lib/api';
import { invitableRoles, ROLE_LABELS } from '@/utils/workspaceRoles';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTeamsQuery } from '@/services/teams.service';
import { useCreateInvite } from '../services/workspace.service';

// Invites a person to the workspace by email, as a role up to the viewer's own,
// optionally into teams. The account created for the email takes the role and
// joins the teams.
export default function WorkspaceInviteDialog({ viewerRole }: { viewerRole: WorkspaceRole }) {
  const roles = invitableRoles(viewerRole);
  const teams = useTeamsQuery().data ?? [];
  const createInvite = useCreateInvite();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [teamIds, setTeamIds] = useState<string[]>([]);

  if (roles.length === 0) return null;

  function reset() {
    setEmail('');
    setRole('member');
    setTeamIds([]);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    // The failed mutation is toasted by the global handler; keep the dialog open.
    await createInvite.mutateAsync({ email: email.trim(), role, teamIds });
    reset();
    setOpen(false);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        Invite
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Invite to the workspace</DialogTitle>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as InviteRole)}>
                <SelectTrigger className="w-40">
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
            </div>
            {teams.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label>Teams</Label>
                {teams.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={teamIds.includes(t.id)}
                      onCheckedChange={(on) =>
                        setTeamIds((ids) =>
                          on === true ? [...ids, t.id] : ids.filter((id) => id !== t.id),
                        )
                      }
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <Button type="submit" disabled={createInvite.isPending || !email.trim()}>
                {createInvite.isPending ? 'Inviting…' : 'Send invite'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
