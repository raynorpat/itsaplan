// The users the API accepts as an initiative's owner: active non-guests who can see
// it. With a private lead team that means its members; with a public lead team or
// none, every non-guest (they see public teams).
export function ownerCandidates<T extends { id: string; guest: boolean; active: boolean }>(
  users: T[],
  leadTeam: { private: boolean; memberIds: string[] } | null,
): T[] {
  return users.filter(
    (u) => u.active && !u.guest && (!leadTeam?.private || leadTeam.memberIds.includes(u.id)),
  );
}
