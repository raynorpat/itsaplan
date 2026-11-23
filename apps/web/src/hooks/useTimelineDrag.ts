import { useState } from 'react';
import type { Issue, IssuePatch } from '@/types/issue';
import type { TeamDetail } from '@/types/team';
import { addDays, toDateStr } from '@/utils/dates';
import { buildGroups, groupKeyOf } from '@/utils/team';
import { useUpdateIssue } from '@/services/issues.service';
import type { GroupField } from '@/utils/viewSettings';
import { effSpan } from '@/utils/timeline';

// Whether a bar drag moves the whole span or resizes one end.
// The bar's start comes from the issue (Linear issues have no start date), so a
// drag moves the bar or its end, and both change only the due date.
export type TimelineDragMode = 'move' | 'end';

interface DragSession {
  startX: number;
  origStart: Date;
  origEnd: Date;
  curStart: Date;
  curEnd: Date;
  deltaDays: number;
  origGroupKey: string;
  targetGroupKey: string;
}

// Pointer-drag state and handlers for the timeline bars. A drag moves the bar
// (rewriting start/due dates and, on a vertical move, the selected group) or resizes one
// end; a gesture with no change opens the issue. `preview` is the in-progress
// span for the dragged issue; `dropGroupKey` is the group under the cursor
// during a move (null when it matches the origin), used to highlight the target.
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
  const [preview, setPreview] = useState<{ issueId: string; start: Date; end: Date } | null>(null);
  const [dropGroupKey, setDropGroupKey] = useState<string | null>(null);

  function beginDrag(e: React.PointerEvent, issue: Issue, mode: TimelineDragMode) {
    e.preventDefault();
    e.stopPropagation();
    const span = effSpan(issue);
    const issueGroupKey = groupKeyOf(issue, group);
    const session: DragSession = {
      startX: e.clientX,
      origStart: span.start,
      origEnd: span.end,
      curStart: span.start,
      curEnd: span.end,
      deltaDays: 0,
      origGroupKey: issueGroupKey,
      targetGroupKey: issueGroupKey,
    };

    const onMove = (ev: PointerEvent) => {
      const deltaDays = Math.round((ev.clientX - session.startX) / dayW);
      session.deltaDays = deltaDays;
      let start = session.origStart;
      let end = session.origEnd;
      if (mode === 'move') {
        start = addDays(session.origStart, deltaDays);
        end = addDays(session.origEnd, deltaDays);
        const rowEl = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest('[data-group-key]');
        if (rowEl) {
          session.targetGroupKey = rowEl.getAttribute('data-group-key') ?? session.origGroupKey;
          setDropGroupKey(
            session.targetGroupKey === session.origGroupKey ? null : session.targetGroupKey,
          );
        }
      } else {
        end = addDays(session.origEnd, deltaDays);
        if (end < start) end = start;
      }
      session.curStart = start;
      session.curEnd = end;
      setPreview({ issueId: issue.id, start, end });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setPreview(null);
      setDropGroupKey(null);

      const patch: IssuePatch = {};
      if (mode === 'move') {
        // Only rewrite the due date on a horizontal move, so a purely vertical
        // drag changes the status alone.
        if (session.deltaDays !== 0) patch.dueDate = toDateStr(session.curEnd);
        if (session.targetGroupKey !== session.origGroupKey) {
          const assign = groupByKey.get(session.targetGroupKey)?.assign;
          if (assign) Object.assign(patch, assign);
        }
      } else if (session.deltaDays !== 0) {
        patch.dueDate = toDateStr(session.curEnd);
      }

      // Nothing changed — treat the gesture as a click that opens the issue.
      if (Object.keys(patch).length === 0) {
        onOpenIssue(issue.id);
        return;
      }
      updateIssue.mutate({ id: issue.id, patch });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return { preview, dropGroupKey, beginDrag };
}
