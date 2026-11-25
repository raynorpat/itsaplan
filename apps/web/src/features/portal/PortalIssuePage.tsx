'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, PackageCheck } from 'lucide-react';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import { Skeleton } from '@/components/ui/skeleton';
import { usePortalBoard, usePortalIssue } from './services/portal.service';
import PortalComments from './components/issue/PortalComments';
import PortalMessage from './components/PortalMessage';
import PortalStatusBadge from './components/PortalStatusBadge';
import PortalVoteButton from './components/PortalVoteButton';
import { shippedLabel } from './utils/portal';

// /portal/<slug>/<identifier>: one issue with its vote, description (when the board
// shows descriptions) and comments.
export default function PortalIssuePage() {
  const { slug, identifier } = useParams<{ slug: string; identifier: string }>();
  const board = usePortalBoard(slug).data;
  const issue = usePortalIssue(slug, identifier);
  if (!board) return null;
  if (issue.isPending) return <Skeleton className="h-64 w-full" />;
  if (issue.error)
    return (
      <PortalMessage title="Request not found" text="It may have been removed from this board." />
    );
  const signedIn = !!board.visitor;
  const shipped = shippedLabel(issue.data.shipped ?? null);

  return (
    <article className="flex flex-col gap-6">
      <Link
        href={`/portal/${slug}`}
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        All requests
      </Link>
      <header className="flex items-start gap-3">
        <PortalVoteButton slug={slug} issue={issue.data} signedIn={signedIn} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="text-xl font-semibold">{issue.data.title}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <PortalStatusBadge status={issue.data.status} underReview={issue.data.underReview} />
            {shipped && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <PackageCheck className="size-4" aria-hidden />
                {shipped}
              </span>
            )}
          </div>
        </div>
      </header>
      {issue.data.description && (
        <MarkdownEditor
          className="text-[15px]"
          defaultValue={issue.data.description}
          editable={false}
        />
      )}
      <PortalComments slug={slug} identifier={identifier} signedIn={signedIn} />
    </article>
  );
}
