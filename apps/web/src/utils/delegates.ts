import type { Assignee } from '@/types/team';
import type { TeamAppUser } from '@/utils/mentionCandidates';

// The agents an issue can be delegated to: the team's app users whose install
// granted app:assignable, marked as apps.
export function delegateCandidates(appUsers: TeamAppUser[]): Assignee[] {
  return appUsers
    .filter((u) => u.isAssignable)
    .map((u) => ({ userId: u.id, name: u.name, email: '', image: u.avatarUrl, app: true }));
}
