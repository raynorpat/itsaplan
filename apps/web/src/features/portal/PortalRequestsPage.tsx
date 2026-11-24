'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePortalBoard, usePortalIssues, type PortalSort } from './services/portal.service';
import PortalIssueRow from './components/PortalIssueRow';
import PortalMessage from './components/PortalMessage';
import PortalRequestsToolbar from './components/requests/PortalRequestsToolbar';
import PortalSuggestDialog from './components/requests/PortalSuggestDialog';

// /portal/<slug>: the board's issues by votes or by date, with search and Suggest.
export default function PortalRequestsPage() {
  const { slug } = useParams<{ slug: string }>();
  const board = usePortalBoard(slug).data;
  const [sort, setSort] = useState<PortalSort>('top');
  const [q, setQ] = useState('');
  const issues = usePortalIssues(slug, sort, useDebouncedValue(q.trim(), 250), !!board?.canRead);
  const [suggesting, setSuggesting] = useState(false);
  if (!board) return null;
  const signedIn = !!board.visitor;

  let list: ReactNode;
  if (issues.isPending) list = <Skeleton className="h-40 w-full" />;
  else if (issues.data?.length)
    list = (
      <ul className="flex flex-col">
        {issues.data.map((issue) => (
          <PortalIssueRow key={issue.identifier} slug={slug} issue={issue} signedIn={signedIn} />
        ))}
      </ul>
    );
  else
    list = (
      <PortalMessage
        title={q ? 'No matching requests' : 'No requests yet'}
        text={q ? 'Try other words.' : 'Requests the team shares appear here.'}
      />
    );

  return (
    <section className="flex flex-col gap-4">
      {(board.intro || board.suggestionsEnabled) && (
        <div className="flex items-start gap-4">
          {board.intro && (
            <p className="flex-1 text-sm whitespace-pre-wrap text-muted-foreground">
              {board.intro}
            </p>
          )}
          {board.suggestionsEnabled &&
            (signedIn ? (
              <Button className="ml-auto" onClick={() => setSuggesting(true)}>
                Suggest a request
              </Button>
            ) : (
              <Button asChild variant="outline" className="ml-auto">
                <Link href={`/portal/${slug}/sign-in`}>Sign in to suggest</Link>
              </Button>
            ))}
        </div>
      )}
      <PortalRequestsToolbar sort={sort} onSort={setSort} q={q} onQ={setQ} />
      {list}
      {suggesting && <PortalSuggestDialog slug={slug} onClose={() => setSuggesting(false)} />}
    </section>
  );
}
