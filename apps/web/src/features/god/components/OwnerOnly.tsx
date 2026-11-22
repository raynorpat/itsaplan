'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/auth-client';
import { toWorkspaceRole } from '@/utils/workspaceRoles';

// Renders its content read-only, with a note, unless the session user is the
// workspace owner. The role is read after mount, as GodShell does, because the
// session can be in the store on hydration while the server rendered without it.
export default function OwnerOnly({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isOwner = mounted && toWorkspaceRole(session?.user.workspaceRole) === 'owner';
  if (isOwner) return <>{children}</>;
  return (
    <>
      <p className="mx-auto w-full max-w-3xl px-6 pt-6 text-sm text-muted-foreground">
        Only a workspace owner can change these settings.
      </p>
      <fieldset disabled className="contents">
        {children}
      </fieldset>
    </>
  );
}
