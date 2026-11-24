'use client';

import { useState } from 'react';
import { useDeleteFeedback, useUpdateFeedback } from '@/services/feedback.service';
import type { FeedbackItem } from '@/utils/feedback';
import FeedbackActionsMenu from './FeedbackActionsMenu';
import FeedbackItemRow from './FeedbackItemRow';
import FeedbackMoveDialog from './FeedbackMoveDialog';
import FeedbackQuoteEditor from './FeedbackQuoteEditor';

// A feedback item on the issue page for someone who may change it: edit the quote,
// mark it important, move it to another issue, delete it.
export default function FeedbackEditableItem({
  item,
  issueId,
  teamKey,
  highlighted,
}: {
  item: FeedbackItem;
  issueId: string;
  teamKey: string;
  highlighted: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const update = useUpdateFeedback(issueId);
  const remove = useDeleteFeedback(issueId);

  return (
    <>
      <FeedbackItemRow
        item={item}
        highlighted={highlighted}
        editor={
          editing ? (
            <FeedbackQuoteEditor
              initial={item.body ?? ''}
              saving={update.isPending}
              onCancel={() => setEditing(false)}
              onSave={(body) =>
                update.mutate(
                  { id: item.id, body: body.trim() || null },
                  { onSuccess: () => setEditing(false) },
                )
              }
            />
          ) : undefined
        }
        actions={
          <FeedbackActionsMenu
            important={item.important}
            onEdit={() => setEditing(true)}
            onToggleImportant={() => update.mutate({ id: item.id, important: !item.important })}
            onMove={() => setMoving(true)}
            onDelete={() => remove.mutate(item.id)}
          />
        }
      />
      {moving && (
        <FeedbackMoveDialog
          teamKey={teamKey}
          currentIssueId={issueId}
          pending={update.isPending}
          onClose={() => setMoving(false)}
          onPick={(target) =>
            update.mutate({ id: item.id, issueId: target }, { onSuccess: () => setMoving(false) })
          }
        />
      )}
    </>
  );
}
