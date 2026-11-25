import { useState } from 'react';
import type { Issue, IssuePatch } from '@/types/issue';
import type { TeamDetail } from '@/types/team';
import { toDateStr } from '@/utils/dates';
import { buildGroups, groupKeyOf } from '@/utils/team';
import { useUpdateIssue } from '@/services/issues.service';
import type { GroupField } from '@/utils/viewSettings';
import { effSpan } from '@/utils/timeline';
import { useTimelineDateDrag } from '@/hooks/useTimelineDateDrag';

// Whether a bar drag moves the whole span or resizes one end.
// The bar's start comes from the issue (Linear issues have no start date), so a
// drag moves the bar or its end, and both change only the due date.
export type TimelineDragMode = 'move' | 'end';

// The issue timeline's drag: the shared date drag, plus the group under the
// pointer. A move rewrites the due date and, on a vertical move, the selected
// group; a resize rewrites the due date; a gesture with no change opens the issue.
// `preview` is the in-progress span of the dragged issue; `dropGroupKey` is the
// group under the cursor during a move (null when it matches the origin), used to
// highlight the target.
export function useTimelineDrag({
  team,
  group,
  dayW,
  onOpenIssue,
}: {
  team: TeamDetail;
  group: GroupField;
  dayW: number;
  onOpenIssue: (id: string) => void;
}) {
  const updateIssue = useUpdateIssue(team.team.key);
  const groupByKey = new Map(
    buildGroups(team, group).map((issueGroup) => [issueGroup.key, issueGroup]),
  );
  const { preview: datePreview, beginDateDrag } = useTimelineDateDrag({ dayW });
  const [dropGroupKey, setDropGroupKey] = useState<string | null>(null);

  function beginDrag(e: React.PointerEvent, issue: Issue, mode: TimelineDragMode) {
    const span = effSpan(issue);
    const origGroupKey = groupKeyOf(issue, group);
    let targetGroupKey = origGroupKey;

    beginDateDrag(e, {
      id: issue.id,
      start: span.start,
      end: span.end,
      mode,
      onMove: (ev) => {
        if (mode !== 'move') return;
        const rowEl = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest('[data-group-key]');
        if (!rowEl) return;
        targetGroupKey = rowEl.getAttribute('data-group-key') ?? origGroupKey;
        setDropGroupKey(targetGroupKey === origGroupKey ? null : targetGroupKey);
      },
      onDrop: ({ end, deltaDays }) => {
        setDropGroupKey(null);
        const patch: IssuePatch = {};
        // Only rewrite the due date on a horizontal move, so a purely vertical drag
        // changes the group alone.
        if (deltaDays !== 0) patch.dueDate = toDateStr(end);
        if (mode === 'move' && targetGroupKey !== origGroupKey) {
          const assign = groupByKey.get(targetGroupKey)?.assign;
          if (assign) Object.assign(patch, assign);
        }
        // Nothing changed: treat the gesture as a click that opens the issue.
        if (Object.keys(patch).length === 0) {
          onOpenIssue(issue.id);
          return;
        }
        updateIssue.mutate({ id: issue.id, patch });
      },
    });
  }

  const preview = datePreview
    ? { issueId: datePreview.id, start: datePreview.start, end: datePreview.end }
    : null;
  return { preview, dropGroupKey, beginDrag };
}
