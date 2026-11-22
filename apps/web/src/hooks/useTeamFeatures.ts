import { useContext } from 'react';
import { ShellCtx } from '@/context/shellContext';
import type { TeamFeatures } from '@/lib/api';

// Which optional sections the active team shows, read from the payload the
// Shell loads. An owner toggles them in Settings -> General.
//
// A disabled section is hidden, not blocked: the rows behind it stay and show
// again once it is turned back on. Without a team every section reads as off,
// the same way usePermissions grants nothing until the team is there.
export function useTeamFeatures(): TeamFeatures {
  const team = useContext(ShellCtx)?.team ?? null;
  if (!team) return { projects: false };
  return { projects: team.team.projectsEnabled };
}
