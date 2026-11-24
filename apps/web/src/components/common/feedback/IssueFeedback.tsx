'use client';

import { useState } from 'react';
import { MessageSquareQuote, Plus } from 'lucide-react';
import { useFeedbackHighlight } from '@/hooks/useFeedbackHighlight';
import { useIssueFeedbackQuery } from '@/services/feedback.service';
import { countPeople, feedbackHeader } from '@/utils/feedback';
import FeedbackAddDialog from './FeedbackAddDialog';
import FeedbackEditableItem from './FeedbackEditableItem';
import FeedbackItemRow from './FeedbackItemRow';

// The issue's feedback, as Linear shows customer requests: "Feedback · 4 people", one
// row per item, and "+ Add feedback" for someone who may edit the issue. Shown to
// owners, admins and members only; the API gives guests no feedback (see the caller).
export default function IssueFeedback({
  issueId,
  teamKey,
  canEdit,
}: {
  issueId: string;
  teamKey: string;
  canEdit: boolean;
}) {
  const query = useIssueFeedbackQuery(issueId, { enabled: true });
  const items = query.data ?? [];
  const highlighted = useFeedbackHighlight(query.isSuccess);
  const [adding, setAdding] = useState(false);

  if (items.length === 0 && !canEdit) return null;

  return (
    <section className="mt-5" aria-label="Feedback">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <MessageSquareQuote className="size-3.5" aria-hidden />
          {feedbackHeader(countPeople(items))}
        </h3>
        {canEdit && (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3.5" aria-hidden />
            Add feedback
          </button>
        )}
      </div>
      {items.length > 0 && (
        <ul className="-mx-2">
          {items.map((item) =>
            canEdit ? (
              <FeedbackEditableItem
                key={item.id}
                item={item}
                issueId={issueId}
                teamKey={teamKey}
                highlighted={highlighted !== null && highlighted === item.attachmentId}
              />
            ) : (
              <FeedbackItemRow
                key={item.id}
                item={item}
                highlighted={highlighted !== null && highlighted === item.attachmentId}
              />
            ),
          )}
        </ul>
      )}
      {adding && <FeedbackAddDialog issueId={issueId} onClose={() => setAdding(false)} />}
    </section>
  );
}
