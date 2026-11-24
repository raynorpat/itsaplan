'use client';

import { toast } from 'sonner';
import { useSession } from '@/lib/auth-client';
import {
  useAddEmailAddress,
  useEmailAddressesQuery,
  useRemoveEmailAddress,
} from '../../services/emailAddresses.service';
import AccountProfileEmailAddForm from './AccountProfileEmailAddForm';
import AccountProfileEmailRow from './AccountProfileEmailRow';

const MAX_EXTRA = 10;

// The sign-in address and the extra addresses. An added address is confirmed on the
// page its mailed link opens (/confirm-email).
export default function AccountProfileEmails() {
  const { data: session } = useSession();
  const emails = useEmailAddressesQuery();
  const add = useAddEmailAddress();
  const remove = useRemoveEmailAddress();
  const extras = emails.data ?? [];
  const busy = add.isPending || remove.isPending;

  return (
    <div>
      <ul className="divide-y">
        {session && <AccountProfileEmailRow email={session.user.email} signIn verified />}
        {extras.map((e) => (
          <AccountProfileEmailRow
            key={e.id}
            email={e.email}
            signIn={false}
            verified={e.verified}
            busy={busy}
            onResend={() =>
              add.mutate(e.email, {
                onSuccess: () => toast.success(`Confirmation link sent to ${e.email}`),
              })
            }
            onRemove={() => remove.mutate(e.id)}
          />
        ))}
      </ul>
      {emails.isError && <p className="text-sm text-destructive">The addresses did not load.</p>}
      <AccountProfileEmailAddForm disabled={extras.length >= MAX_EXTRA} />
    </div>
  );
}
