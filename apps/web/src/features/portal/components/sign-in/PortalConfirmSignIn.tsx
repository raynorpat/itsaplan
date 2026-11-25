'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { UPDATES_NOTICE } from '@/utils/updatesNotice';
import { useConfirmSignIn, useLinkInfo } from '../../services/portal.service';
import PortalSignInForm from './PortalSignInForm';

// The page a sign-in link opens. Signing in needs a press of the button, so a mail
// scanner that opens the link does not use it. A first sign-in also asks for a name.
export default function PortalConfirmSignIn({ slug, token }: { slug: string; token: string }) {
  const router = useRouter();
  const info = useLinkInfo(token);
  const confirm = useConfirmSignIn();
  const [name, setName] = useState('');

  if (info.isPending) return <Skeleton className="h-24 w-full" />;
  if (info.error)
    return (
      <>
        <p className="text-sm text-muted-foreground">
          This link is not valid or has expired. Ask for a new one below.
        </p>
        <PortalSignInForm slug={slug} />
      </>
    );
  const needsName = info.data.needsName;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (needsName && !name.trim()) return;
        confirm.mutate(
          { token, ...(needsName ? { name: name.trim() } : {}) },
          { onSuccess: () => router.replace(`/portal/${slug}`) },
        );
      }}
    >
      {needsName && (
        <label className="flex flex-col gap-1 text-sm">
          Your name
          <Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <p className="text-xs text-muted-foreground">{UPDATES_NOTICE}</p>
      <Button type="submit" disabled={confirm.isPending || (needsName && !name.trim())}>
        Sign in
      </Button>
    </form>
  );
}
