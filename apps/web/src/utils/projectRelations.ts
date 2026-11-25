// Project dependencies (Linear's ProjectRelation): the source project's anchor
// (`from`) blocks the related project's anchor (`to`). An anchor is the project's
// start date, its target date or one of its milestones' target date.

export type AnchorType = 'start' | 'end' | 'milestone';

export interface RelationEnd {
  projectId: string;
  projectName: string;
  startDate: string | null;
  targetDate: string | null;
  anchorType: AnchorType;
  milestone: { id: string; name: string; targetDate: string | null } | null;
}

export interface ProjectRelationItem {
  id: string;
  // The blocking side (the relation's project) and the blocked side (its related project).
  from: RelationEnd;
  to: RelationEnd;
}

// The date of an anchor ('YYYY-MM-DD'), or null when it is not set.
export function anchorDate(end: RelationEnd): string | null {
  switch (end.anchorType) {
    case 'start':
      return end.startDate;
    case 'end':
      return end.targetDate;
    case 'milestone':
      return end.milestone?.targetDate ?? null;
  }
}

// A relation is in conflict when the blocking anchor's date is after the blocked
// anchor's date. Missing dates never conflict. Dates are 'YYYY-MM-DD', so they
// compare as strings.
export function isConflict(relation: ProjectRelationItem): boolean {
  const blocking = anchorDate(relation.from);
  const blocked = anchorDate(relation.to);
  return blocking !== null && blocked !== null && blocking > blocked;
}

export function anchorLabel(anchorType: AnchorType, milestoneName?: string): string {
  if (anchorType === 'milestone') return milestoneName ? `milestone ${milestoneName}` : 'milestone';
  return anchorType;
}

export interface ProjectDependencies {
  blockedBy: ProjectRelationItem[];
  blocking: ProjectRelationItem[];
}

// Each project's relations: blocking where it is the source, blocked by where it is
// the related project.
export function relationsByProject(
  relations: ProjectRelationItem[],
): Map<string, ProjectDependencies> {
  const map = new Map<string, ProjectDependencies>();
  const entry = (id: string) => {
    let deps = map.get(id);
    if (!deps) {
      deps = { blockedBy: [], blocking: [] };
      map.set(id, deps);
    }
    return deps;
  };
  for (const r of relations) {
    entry(r.from.projectId).blocking.push(r);
    entry(r.to.projectId).blockedBy.push(r);
  }
  return map;
}

// The projects on either side of a dependency whose dates conflict.
export function conflictingProjectIds(relations: ProjectRelationItem[]): Set<string> {
  const ids = new Set<string>();
  for (const r of relations)
    if (isConflict(r)) {
      ids.add(r.from.projectId);
      ids.add(r.to.projectId);
    }
  return ids;
}
