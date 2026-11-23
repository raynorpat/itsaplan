import type { ProjectChange } from './projectInput';

interface Member {
  id: string;
  name: string;
  image: string | null;
}

// The project as it will be after a change, for the optimistic cache: the changed
// fields applied, and the members rebuilt in memberIds order from the current
// members and the given people. Teams and the status id come from the refetch.
export function patchProject<
  T extends {
    members: Member[];
    leadUserId: string | null;
    labelIds: string[];
  },
>(project: T, change: ProjectChange, people: Member[] = []): T {
  const { memberIds, ...fields } = change;
  const next: T = { ...project };
  for (const [key, value] of Object.entries(fields))
    if (value !== undefined && key !== 'teamIds') (next as Record<string, unknown>)[key] = value;
  if (memberIds !== undefined) {
    const known = new Map([...people, ...project.members].map((m) => [m.id, m]));
    next.members = memberIds.flatMap((id) => known.get(id) ?? []);
  }
  return next;
}
