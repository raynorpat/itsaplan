'use client';

import { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import type { InviteRow } from '@/lib/api';
import { formatShortDate } from '@/utils/dates';
import { inviteLink } from '@/utils/paths';
import { ROLE_LABELS } from '@/utils/workspaceRoles';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// A pending invite: who, as which role, with a copy-link button and, for its sender
// or an admin, a revoke action. The link uses the current web origin so it works
// in any deployment.
export default function WorkspaceInviteRow({
  invite,
  teamNames,
  canRevoke,
  onRevoke,
}: {
  invite: InviteRow;
  teamNames: string[];
  canRevoke: boolean;
  onRevoke: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    if (!invite.token) return;
    try {
      await navigator.clipboard.writeText(inviteLink(origin, invite.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (no permission / insecure origin); ignore.
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          <span className="truncate">{invite.email}</span>
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
            {ROLE_LABELS[invite.role]}
          </Badge>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {invite.invitedByName ? `Invited by ${invite.invitedByName} · ` : ''}expires{' '}
          {formatShortDate(invite.expiresAt)}
          {teamNames.length > 0 ? ` · ${teamNames.join(', ')}` : ''}
        </p>
      </div>
      {/* The link is shown only to the invite's sender and to admins (token set). */}
      {invite.token && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      )}
      {canRevoke && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          aria-label="Revoke invite"
          onClick={onRevoke}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
