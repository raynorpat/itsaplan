import type { ReactNode } from 'react';

// The Shell's content area. It renders the routed page once the team is
// loaded, and stands in for it while loading, when the account has no teams
// yet, or when this team is not readable by the viewer.
export default function ShellBody({
  forbidden,
  hasTeam,
  hasError,
  teamsLoaded,
  teamCount,
  children,
}: {
  forbidden: boolean;
  hasTeam: boolean;
  hasError: boolean;
  teamsLoaded: boolean;
  teamCount: number;
  children: ReactNode;
}) {
  if (forbidden) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        You do not have access to this team.
      </div>
    );
  }
  // The routed page reads the team from the Shell context, so it is mounted
  // only once the team is there. A missing or failed team keeps the body on
  // a message; the error itself is shown by the banner above.
  if (!hasTeam) {
    if (hasError)
      return (
        <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
          This team is not available.
        </div>
      );
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {teamsLoaded && teamCount === 0 ? 'No teams yet, create one to get started.' : 'Loading…'}
      </div>
    );
  }
  return <>{children}</>;
}
