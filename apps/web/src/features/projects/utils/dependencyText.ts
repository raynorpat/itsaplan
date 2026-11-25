import { anchorLabel, type ProjectRelationItem, type RelationEnd } from '@/utils/projectRelations';

const label = (end: RelationEnd) => anchorLabel(end.anchorType, end.milestone?.name);

// A dependency in words, seen from one of its projects: the blocking anchor, then
// the blocked one ("Its end → this project's start").
export function dependencyText(relation: ProjectRelationItem, thisProjectId: string): string {
  if (relation.to.projectId === thisProjectId)
    return `Its ${label(relation.from)} → this project's ${label(relation.to)}`;
  return `This project's ${label(relation.from)} → its ${label(relation.to)}`;
}
