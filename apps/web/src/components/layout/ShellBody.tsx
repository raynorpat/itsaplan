import type { ReactNode } from 'react';
import type { ShellBodyState } from '@/utils/shellRoute';

const MESSAGES: Record<Exclude<ShellBodyState, 'page'>, string> = {
  forbidden: 'You do not have access to this team.',
  unavailable: 'This team is not available.',
  'no-teams': 'No teams yet, create one to get started.',
  loading: 'Loading…',
};

// The Shell's content area: the routed page, or the message that stands in for it
// (see shellBodyState). A failed team's error itself is shown by the banner above.
export default function ShellBody({
  state,
  children,
}: {
  state: ShellBodyState;
  children: ReactNode;
}) {
  if (state === 'page') return <>{children}</>;
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {MESSAGES[state]}
    </div>
  );
}
