'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSignOut, type PortalVisitor } from '../services/portal.service';
import PortalNameDialog from './PortalNameDialog';
import PortalUpdatesDialog from './updates/PortalUpdatesDialog';

export default function PortalVisitorMenu({
  slug,
  visitor,
}: {
  slug: string;
  visitor: PortalVisitor | null;
}) {
  const [editing, setEditing] = useState(false);
  const [updates, setUpdates] = useState(false);
  const signOut = useSignOut();
  if (!visitor)
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={`/portal/${slug}/sign-in`}>Sign in</Link>
      </Button>
    );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            {visitor.displayName}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>Change your name</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setUpdates(true)}>Email updates</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => signOut.mutate()}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing && (
        <PortalNameDialog slug={slug} visitor={visitor} onClose={() => setEditing(false)} />
      )}
      {updates && <PortalUpdatesDialog onClose={() => setUpdates(false)} />}
    </>
  );
}
