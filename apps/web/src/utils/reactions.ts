// Reactions on an issue or a comment, grouped by emoji for the chip row. Groups
// keep the order in which each emoji first appears; `mineId` is the viewer's own
// reaction with that emoji, so clicking the chip can remove it.

export interface ReactionNode {
  id: string;
  emoji: string;
  user: { id: string; name: string } | null;
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  users: string[];
  mineId: string | null;
}

export function groupReactions(
  reactions: ReactionNode[],
  viewerId: string | null,
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const reaction of reactions) {
    let group = groups.get(reaction.emoji);
    if (!group) {
      group = { emoji: reaction.emoji, count: 0, users: [], mineId: null };
      groups.set(reaction.emoji, group);
    }
    group.count += 1;
    if (reaction.user) group.users.push(reaction.user.name);
    if (viewerId != null && reaction.user?.id === viewerId) group.mineId = reaction.id;
  }
  return [...groups.values()];
}
