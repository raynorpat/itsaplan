import { DragOverlay } from '@dnd-kit/core';
import type { Issue } from '@/types/issue';
import { type Maps } from '@/utils/team';
import { estimateLabel, estimatesUsed, type TeamEstimateSettings } from '@/utils/estimates';
import type { PropertyKey } from '@/utils/viewSettings';
import { EstimateBadge } from '@/components/common/issue/EstimateBadge';
import { IssueCardBody } from './IssueCardBody';

// The drag preview shown under the cursor while a card is dragged. Slightly
// transparent, so it does not hide the drop line or the cards it would land
// between.
export function CardOverlay({
  activeId,
  issues,
  maps,
  properties,
  estimates,
}: {
  activeId: string | null;
  issues: Issue[];
  maps: Maps;
  properties: PropertyKey[];
  // The team's estimate scale: the preview shows a T-shirt size, and no estimate
  // while the team does not use estimates, as the card does.
  estimates: TeamEstimateSettings;
}) {
  const issue = activeId != null ? (issues.find((i) => i.id === activeId) ?? null) : null;
  // dropAnimation is disabled: the move is applied optimistically, so the card
  // is already in its new place when the drag ends. The default animation would
  // fly the overlay back to the source position first, making the card look like
  // it snaps back before reappearing in the target column.
  return (
    <DragOverlay dropAnimation={null}>
      {issue ? (
        <div className="kanban-card cursor-grabbing rounded-md p-3 opacity-85 shadow-lg">
          <IssueCardBody
            issue={issue}
            maps={maps}
            properties={properties}
            estimateChip={
              estimatesUsed(estimates) && issue.estimate != null ? (
                <EstimateBadge
                  estimate={issue.estimate}
                  label={estimateLabel(estimates, issue.estimate)}
                />
              ) : null
            }
          />
        </div>
      ) : null}
    </DragOverlay>
  );
}
