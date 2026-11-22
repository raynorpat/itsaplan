'use client';

import Link from 'next/link';
import { type InviteView } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import InviteAuthForm from './InviteAuthForm';
import InviteNotice from './InviteNotice';

// What the invitee does next: sign up with the invited email, or, when already
// signed in, go to the app (a signed-in user already belongs to the workspace).
export default function InviteStep({ invite }: { invite: InviteView }) {
  const { data: session, isPending: sessionPending } = useSession();

  if (sessionPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!session) return <InviteAuthForm email={invite.email} />;

  return (
    <InviteNotice
      message={
        <>
          You are signed in as{' '}
          <span className="font-medium text-foreground">{session.user.email}</span>, which already
          belongs to this workspace. The invite is for a new account with{' '}
          <span className="font-medium text-foreground">{invite.email}</span>.
        </>
      }
    >
      <Button asChild variant="outline">
        <Link href="/">Go to the app</Link>
      </Button>
    </InviteNotice>
  );
}
