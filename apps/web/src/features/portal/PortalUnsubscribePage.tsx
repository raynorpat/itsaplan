'use client';

import { useSearchParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useUnsubscribeInfo } from './services/portal.service';
import PortalMessage from './components/PortalMessage';
import PortalUnsubscribeChoices from './components/unsubscribe/PortalUnsubscribeChoices';

// /portal/unsubscribe?token=: the page every update email links to.
export default function PortalUnsubscribePage() {
  const token = useSearchParams().get('token') ?? '';
  const info = useUnsubscribeInfo(token);

  let body;
  if (!token || info.error)
    body = (
      <PortalMessage
        title="This link is not valid"
        text="Use the unsubscribe link in one of the emails you received."
      />
    );
  else if (info.isPending) body = <Skeleton className="h-32 w-full" />;
  else
    body = (
      <section className="mx-auto flex max-w-md flex-col gap-4 py-16">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold">Email updates</h1>
          {info.data.email && (
            <p className="text-sm text-muted-foreground">For {info.data.email}</p>
          )}
        </div>
        <PortalUnsubscribeChoices token={token} prefs={info.data.prefs} />
      </section>
    );

  return (
    <div className="min-h-svh bg-background">
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">{body}</main>
    </div>
  );
}
