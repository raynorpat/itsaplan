'use client';

import { useParams, useSearchParams } from 'next/navigation';
import PortalConfirmSignIn from './components/sign-in/PortalConfirmSignIn';
import PortalSignInForm from './components/sign-in/PortalSignInForm';

// /portal/<slug>/sign-in: the email form, or with ?token= the confirm step of a link.
export default function PortalSignInPage() {
  const { slug } = useParams<{ slug: string }>();
  const token = useSearchParams().get('token') ?? '';
  return (
    <section className="mx-auto flex max-w-sm flex-col gap-4 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          {token ? 'Confirm to sign in to this board.' : 'We email you a link. No password needed.'}
        </p>
      </div>
      {token ? <PortalConfirmSignIn slug={slug} token={token} /> : <PortalSignInForm slug={slug} />}
    </section>
  );
}
