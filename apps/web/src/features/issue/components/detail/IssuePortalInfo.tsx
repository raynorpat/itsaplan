import { Globe } from 'lucide-react';
import { useIssuePortalBoards, useIssueSuggester } from '../../services/issuePortal.service';

// The portal boards showing the issue, each linking to its portal page, and the
// visitor who suggested it there. Members only; renders nothing otherwise.
export default function IssuePortalInfo({
  issueId,
  identifier,
}: {
  issueId: string;
  identifier: string;
}) {
  const boards = useIssuePortalBoards(issueId, true).data ?? [];
  const suggester = useIssueSuggester(issueId, true).data;
  if (boards.length === 0 && !suggester) return null;
  return (
    <div className="flex flex-col gap-1 px-2 py-1 text-xs text-muted-foreground">
      {boards.length > 0 && (
        <div className="flex items-start gap-1.5">
          <Globe className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            On portal:{' '}
            {boards.map((b, i) => (
              <span key={b.id}>
                {i > 0 && ', '}
                <a
                  href={`/portal/${b.slug}/${identifier}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground hover:underline"
                >
                  {b.name}
                </a>
              </span>
            ))}
          </span>
        </div>
      )}
      {suggester && <div>Suggested by {suggester.name} on the portal</div>}
    </div>
  );
}
