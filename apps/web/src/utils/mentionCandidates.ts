import type { Assignee } from '@/types/team';

// An app user of the team (an OAuth application installed with actor=app), as the
// scaffold loads it. isMentionable / isAssignable are true when the install granted
// app:mentionable / app:assignable.
export interface TeamAppUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  isMentionable: boolean;
  isAssignable: boolean;
}

// The people and apps the comment composer offers for @-mentions: the team's people,
// then the app users whose install allows mentions, marked as apps.
export function mentionCandidates(people: Assignee[], appUsers: TeamAppUser[]): Assignee[] {
  const apps = appUsers
    .filter((u) => u.isMentionable)
    .map((u) => ({ userId: u.id, name: u.name, email: '', image: u.avatarUrl, app: true }));
  return apps.length ? [...people, ...apps] : people;
}
