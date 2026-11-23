// The links behind an initiative's Projects and Sub-initiatives sections.

// The id of the project's link to the initiative (initiativeToProjectDelete takes
// it); null when the project is in the list only through a sub-initiative.
export function linkIdOf(
  project: { initiativeToProjects: { id: string; initiativeId: string }[] },
  initiativeId: string,
): string | null {
  return project.initiativeToProjects.find((l) => l.initiativeId === initiativeId)?.id ?? null;
}

// The initiative's own sub-initiative relations: child id → relation id
// (initiativeRelationDelete takes the relation id).
export function childRelations(
  relations: { id: string; initiativeId: string; relatedInitiativeId: string }[],
  initiativeId: string,
): Map<string, string> {
  return new Map(
    relations
      .filter((r) => r.initiativeId === initiativeId)
      .map((r) => [r.relatedInitiativeId, r.id]),
  );
}

// The projects an add offers: those not linked to the initiative yet.
export function linkableProjects<T extends { id: string }>(all: T[], linked: Set<string>): T[] {
  return all.filter((p) => !linked.has(p.id));
}

// The initiatives an add offers as sub-initiatives, leaving out what the API refuses:
// an initiative that already has a parent (one parent each), the initiative itself
// and its ancestors (a loop). The depth limit is left to the API, which names it.
export function subInitiativeCandidates<T extends { id: string; parentId: string | null }>(
  all: T[],
  initiativeId: string,
): T[] {
  const parentOf = new Map(all.map((i) => [i.id, i.parentId]));
  const above = new Set<string>();
  let id: string | null | undefined = initiativeId;
  while (id && !above.has(id)) {
    above.add(id);
    id = parentOf.get(id);
  }
  return all.filter((i) => i.parentId == null && !above.has(i.id));
}
