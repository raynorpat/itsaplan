'use client';

import { MessageSquareQuote } from 'lucide-react';
import { useIssueFeedbackCountQuery } from '@/services/feedback.service';
import { guestFeedbackText } from '@/utils/feedback';

// What a guest sees in place of the Feedback section: how many people asked for the
// issue, never who or what they said. Nothing when nobody asked.
export default function IssueFeedbackCount({ issueId }: { issueId: string }) {
  const query = useIssueFeedbackCountQuery(issueId, { enabled: true });
  const text = guestFeedbackText(query.data ?? 0);
  if (!text) return null;
  return (
    <p className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground">
      <MessageSquareQuote className="size-3.5" aria-hidden />
      {text}
    </p>
  );
}
