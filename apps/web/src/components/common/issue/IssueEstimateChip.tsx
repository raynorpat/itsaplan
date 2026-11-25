import type { Issue } from '@/types/issue';
import type { TeamDetail } from '@/types/team';
import { useUpdateIssueDetail } from '@/services/issues.service';
import { usePermissions } from '@/hooks/usePermissions';
import { estimateLabel, estimatesUsed } from '@/utils/estimates';
import EstimateSelect from '@/components/common/fields/EstimateSelect';
import { EstimateBadge } from './EstimateBadge';

// A team issue's estimate chip on a list row or board card. For a member who may edit
// issues it opens the estimate picker; guests and read-only boards see the chip alone.
// Nothing for an issue without an estimate or a team that does not estimate.
export default function IssueEstimateChip({
  team,
  issue,
  readOnly,
}: {
  team: TeamDetail;
  issue: Issue;
  readOnly?: boolean;
}) {
  const { can } = usePermissions();
  const updateIssue = useUpdateIssueDetail(team.team.key);
  if (!estimatesUsed(team.estimates) || issue.estimate == null) return null;
  const badge = (
    <EstimateBadge
      estimate={issue.estimate}
      label={estimateLabel(team.estimates, issue.estimate)}
    />
  );
  if (readOnly || team.viewer.workspaceRole === 'guest' || !can('work_items', 'edit')) return badge;
  return (
    // The row and card open the issue on click and start a drag on pointer down; the
    // picker's events (its list renders in a portal but bubbles through React) stop here.
    <span
      className="shrink-0"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <EstimateSelect
        settings={team.estimates}
        value={issue.estimate}
        onChange={(estimate) => updateIssue.mutate({ id: issue.id, patch: { estimate } })}
        trigger={
          <button type="button" aria-label="Change estimate" className="rounded-full">
            {badge}
          </button>
        }
      />
    </span>
  );
}
