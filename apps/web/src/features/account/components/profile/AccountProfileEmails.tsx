'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth-client';
import {
  useAddEmailAddress,
  useEmailAddressesQuery,
  useRemoveEmailAddress,
} from '../../services/emailAddresses.service';
import { confirmResult } from '../../utils/emailAddresses';
import AccountProfileEmailAddForm from './AccountProfileEmailAddForm';
import AccountProfileEmailRow from './AccountProfileEmailRow';

const MAX_EXTRA = 10;

// The sign-in address and the extra addresses. The confirmation link lands back here
// with its result in the URL, shown once as a toast and then removed from the URL.
export default function AccountProfileEmails() {
  const { data: session } = useSession();
  const emails = useEmailAddressesQuery();
  const add = useAddEmailAddress();
  const remove = useRemoveEmailAddress();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const result = confirmResult(params);
    if (!result) return;
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
    router.replace(pathname);
  }, [params, pathname, router]);

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
