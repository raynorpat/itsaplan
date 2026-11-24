'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { emailStatusText } from '../../utils/emailAddresses';

// One address in the Email addresses list: the address, its status, and Remove for an
// extra address. A pending one can be sent a new confirmation link.
export default function AccountProfileEmailRow({
  email,
  signIn,
  verified,
  busy,
  onResend,
  onRemove,
}: {
  email: string;
  signIn: boolean;
  verified: boolean;
  busy?: boolean;
  onResend?: () => void;
  onRemove?: () => void;
}) {
  return (
    <li className="group flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm">{email}</span>
      <span className={verified ? 'text-xs text-muted-foreground' : 'text-xs text-amber-600'}>
        {emailStatusText({ signIn, verified })}
      </span>
      {!signIn && !verified && onResend && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={onResend}>
          Resend link
        </Button>
      )}
      {!signIn && onRemove && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Remove ${email}`}
          title="Remove"
        >
          <X className="size-4" />
        </Button>
      )}
    </li>
  );
}
