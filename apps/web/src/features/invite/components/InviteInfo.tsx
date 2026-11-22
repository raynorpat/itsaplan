import { type InviteView } from '@/lib/api';
import { ROLE_LABELS } from '@/utils/workspaceRoles';
import { Badge } from '@/components/ui/badge';

// The invite summary at the top of the invite screen: the role, the teams the
// account joins, and the invited email.
export default function InviteInfo({ invite }: { invite: InviteView }) {
  return (
    <div className="rounded-md border bg-muted/50 p-4 text-sm">
      <p className="text-muted-foreground">
        {invite.invitedByName ? `${invite.invitedByName} invited you` : 'You have been invited'} to
        join the workspace as
      </p>
      <p className="mt-0.5 flex items-center gap-2 text-base font-semibold">
        <Badge variant="outline" className="px-1.5 py-0 text-xs font-normal">
          {ROLE_LABELS[invite.role]}
        </Badge>
      </p>
      {invite.teamNames.length > 0 && (
        <p className="mt-2 text-muted-foreground">
          Teams: <span className="text-foreground">{invite.teamNames.join(', ')}</span>
        </p>
      )}
      <p className="mt-2 text-muted-foreground">
        Invitation for <span className="font-medium text-foreground">{invite.email}</span>
      </p>
    </div>
  );
}
