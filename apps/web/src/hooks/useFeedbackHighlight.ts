'use client';

import { useEffect, useState } from 'react';

const HIGHLIGHT_MS = 3000;

// The feedback item a link opened (`?feedback=<attachmentId>`, the link a feedback
// item's source attachment carries): once the feedback has loaded, it is scrolled into
// view and highlighted for a few seconds. Read from the location after mount, so the
// server render has nothing highlighted.
export function useFeedbackHighlight(loaded: boolean): string | null {
  const [highlighted, setHighlighted] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) return;
    const id = new URLSearchParams(window.location.search).get('feedback');
    if (!id) return;
    setHighlighted(id);
    document.getElementById(`feedback-${id}`)?.scrollIntoView({ block: 'center' });
    const timer = window.setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [loaded]);

  return highlighted;
}
