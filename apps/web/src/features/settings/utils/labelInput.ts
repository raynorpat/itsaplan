// Linear's labels: a label group is a label with isGroup, and a label joins a group
// through parentId. In an update a null group ungroups the label and an absent one
// leaves its group unchanged. A null team creates a workspace label (shared by
// every team).

export interface LabelFields {
  name?: string;
  color?: string;
  groupId?: string | null;
}

export function labelCreateInput(teamId: string | null, fields: LabelFields & { name: string }) {
  return {
    ...(teamId ? { teamId } : {}),
    name: fields.name,
    ...(fields.color !== undefined ? { color: fields.color } : {}),
    ...(fields.groupId ? { parentId: fields.groupId } : {}),
  };
}

export function labelGroupCreateInput(
  teamId: string | null,
  fields: { name: string; color?: string },
) {
  return {
    ...(teamId ? { teamId } : {}),
    name: fields.name,
    ...(fields.color !== undefined ? { color: fields.color } : {}),
    isGroup: true,
  };
}

export function labelUpdateInput(patch: LabelFields) {
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.groupId !== undefined ? { parentId: patch.groupId } : {}),
  };
}
