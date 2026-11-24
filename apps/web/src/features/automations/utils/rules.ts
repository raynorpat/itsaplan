import type { WorkspaceRole } from '@/types/workspace';
import { isWorkspaceAdmin } from '@/utils/workspaceRoles';

// A team's automation rule as the instance plugin's /instance/workflows* endpoints
// return it (apps/api/src/workflows/store.ts). Fields the page does not use are left
// out.

export type WorkflowTrigger = 'entityCreated' | 'entityUpdated';
export type EditAccess = 'everyone' | 'teamOwners' | 'workspaceAdmins' | 'owner';

export type WorkflowAction =
  | { type: 'setState'; stateId: string }
  | { type: 'setAssignee'; userId: string | null }
  | { type: 'setPriority'; priority: number }
  | { type: 'addLabels'; labelIds: string[] }
  | { type: 'removeLabels'; labelIds: string[] }
  | { type: 'setProject'; projectId: string | null }
  | { type: 'setCycle'; cycleId: string | null }
  | { type: 'setDelegate'; appUserId: string | null }
  | { type: 'addComment'; body: string };

export interface WorkflowRule {
  id: string;
  teamId: string;
  name: string;
  description: string | null;
  trigger: WorkflowTrigger;
  activationMode: 'conditionsStartedMatching' | null;
  conditions: Record<string, unknown>;
  activities: WorkflowAction[];
  enabled: boolean;
  sortOrder: number;
  editAccess: EditAccess;
  ownerId: string | null;
  lastExecutedAt: string | null;
  stats: { runs: number; lastError?: string };
  archivedAt: string | null;
}

// The viewer as the access rules need them: their workspace role and whether they
// manage the team (team owner, workspace admin or owner, or a member of a team
// without owners).
export interface RuleViewer {
  id: string;
  role: WorkspaceRole;
  managesTeam: boolean;
}

// Creating a rule needs a team manager; guests never change rules
// (apps/api/src/workflows/access.ts assertMayCreate).
export function canCreateRule(viewer: Pick<RuleViewer, 'role' | 'managesTeam'>): boolean {
  if (viewer.role === 'guest') return false;
  return isWorkspaceAdmin(viewer.role) || viewer.managesTeam;
}

// Mirror of the API's assertMayEdit: admins and owners change any rule, otherwise the
// rule's edit access decides.
export function canEditRule(
  rule: Pick<WorkflowRule, 'editAccess' | 'ownerId'>,
  viewer: RuleViewer,
): boolean {
  if (viewer.role === 'guest') return false;
  if (isWorkspaceAdmin(viewer.role)) return true;
  switch (rule.editAccess) {
    case 'everyone':
      return true;
    case 'teamOwners':
      return viewer.managesTeam;
    case 'owner':
      return rule.ownerId === viewer.id;
    case 'workspaceAdmins':
      return false;
  }
}

export function triggerSummary(rule: Pick<WorkflowRule, 'trigger'>): string {
  return rule.trigger === 'entityCreated'
    ? 'When an issue is created'
    : 'When an issue starts matching the conditions';
}

// The unarchived rules' ids after dragging `activeId` onto `overId`, in run order.
export function reorderIds(rules: WorkflowRule[], activeId: string, overId: string): string[] {
  const ids = rules.filter((r) => r.archivedAt == null).map((r) => r.id);
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

// The sortOrder that puts `movedId` at its place in `ids`: halfway between its new
// neighbours, or one below the first / above the last. The API's reorder endpoint
// takes one rule's sortOrder, so only the moved rule is written.
export function sortOrderForMove(rules: WorkflowRule[], ids: string[], movedId: string): number {
  const order = new Map(rules.map((r) => [r.id, r.sortOrder]));
  const at = ids.indexOf(movedId);
  const before = at > 0 ? order.get(ids[at - 1]) : undefined;
  const after = at < ids.length - 1 ? order.get(ids[at + 1]) : undefined;
  if (before != null && after != null) return (before + after) / 2;
  if (after != null) return after - 1;
  if (before != null) return before + 1;
  return order.get(movedId) ?? 0;
}
