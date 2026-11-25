import Link from 'next/link';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReleaseWrites } from '@/services/releases.service';
import { issuePath } from '@/utils/paths';
import { groupIssuesByState, type ReleaseIssue } from '../../utils/releaseIssues';
import ReleaseSection from '../ReleaseSection';

// The release's issues grouped by state, each linking to its issue page, with Remove
// for editors. Issues are added from the issue page's Release property or by CI.
export default function ReleaseIssues({
  releaseId,
  issues,
  canEdit,
}: {
  releaseId: string;
  issues: ReleaseIssue[];
  canEdit: boolean;
}) {
  const { removeIssue } = useReleaseWrites();
  return (
    <ReleaseSection title={`Issues · ${issues.length}`}>
      {issues.length === 0 && (
        <p className="px-6 py-3 text-sm text-muted-foreground">
          No issues yet. Add one from an issue&apos;s Release property, or let CI sync add them.
        </p>
      )}
      {groupIssuesByState(issues).map((group) => (
        <div key={group.type} className="flex flex-col">
          <h3 className="px-6 pt-3 pb-1 text-xs font-medium text-muted-foreground">
            {group.label} · {group.issues.length}
          </h3>
          {group.issues.map((issue) => (
            <div key={issue.id} className="flex items-center gap-2 pr-4 hover:bg-muted/50">
              <Link
                href={issuePath(issue.teamKey, issue.number)}
                className="flex min-w-0 flex-1 items-center gap-3 py-1.5 pl-6 text-sm"
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: issue.state.color }}
                />
                <span className="w-16 shrink-0 text-xs text-muted-foreground">
                  {issue.identifier}
                </span>
                <span className="truncate">{issue.title}</span>
              </Link>
              {canEdit && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label={`Remove ${issue.identifier} from this release`}
                  onClick={() => removeIssue.mutate({ issueId: issue.id, releaseId })}
                >
                  <X aria-hidden />
                </Button>
              )}
            </div>
          ))}
        </div>
      ))}
    </ReleaseSection>
  );
}
