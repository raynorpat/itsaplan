'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/graphql';
import { usePortalBoard } from './services/portal.service';
import PortalHeader from './components/PortalHeader';
import PortalRestricted from './components/PortalRestricted';
import PortalMessage from './components/PortalMessage';

// The frame of every portal page: the board's header, then the page. A restricted
// board the visitor cannot read shows only its sign-in form; the sign-in page itself
// always renders (it holds the link's confirm step).
export default function PortalLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const board = usePortalBoard(slug);
  const onSignIn = pathname === `/portal/${slug}/sign-in`;

  let body: ReactNode;
  if (board.isPending) body = <Skeleton className="mt-6 h-40 w-full" />;
  else if (board.error)
    body = (
      <PortalMessage
        title={
          board.error instanceof ApiError && board.error.status === 404
            ? 'Board not found'
            : 'Something went wrong'
        }
        text="Check the link you were given."
      />
    );
  else
    body = (
      <>
        <PortalHeader slug={slug} board={board.data} />
        {board.data.canRead || onSignIn ? (
          children
        ) : (
          <PortalRestricted slug={slug} signedIn={!!board.data.visitor} />
        )}
      </>
    );

  return (
    <div className="min-h-svh bg-background">
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">{body}</main>
    </div>
  );
}
