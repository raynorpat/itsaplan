import type { QueryClient } from '@tanstack/react-query';

// Forgets the subscribers filter's issue-id sets of every team. Subscribing,
// unsubscribing, creating an issue (its creator is subscribed) and commenting (the
// author is subscribed) change them.
export function invalidateSubscribedIssueIds(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({
    predicate: (q) => q.queryKey[0] === 'team' && q.queryKey[2] === 'subscribed-issue-ids',
  });
}
