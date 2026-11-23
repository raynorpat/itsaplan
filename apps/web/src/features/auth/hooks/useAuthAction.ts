'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Runs an auth action while tracking pending + error, and redirects on success: into
// the planner, or to `next` (the page that resumes an OAuth authorization). `setError` is exposed so a form can report client-side
// validation before calling `run`.
//
// Actions that only send an email (reset link, sign-in link, confirmation) end on
// the same screen with a "check your inbox" message instead, so they pass
// `redirect: false` and keep `pending` cleared.
export function useAuthAction(next = '/') {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<void>, options?: { redirect?: boolean }) {
    setError(null);
    setPending(true);
    try {
      await action();
      if (options?.redirect === false) {
        setPending(false);
        return;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setPending(false);
    }
  }

  return { error, pending, setError, run };
}
