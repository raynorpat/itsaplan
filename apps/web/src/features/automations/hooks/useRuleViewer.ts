'use client';

import { useSession } from '@/lib/auth-client';
import type { TeamDetail } from '@/types/team';
import type { RuleViewer } from '../utils/rules';

// The signed-in user as the automation access rules see them in `team`; null until
// the session and the team are known.
export function useRuleViewer(team: TeamDetail | null): RuleViewer | null {
  const userId = useSession().data?.user.id ?? null;
  if (!userId || !team) return null;
  return { id: userId, role: team.viewer.workspaceRole, managesTeam: team.viewer.canManage };
}
