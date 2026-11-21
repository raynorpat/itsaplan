import { type CustomField } from '@/lib/api';

// The team scaffold carries every field of the team; a detail surface takes
// the team-wide ones plus the issue type's own.
export function fieldDefsForType(fields: CustomField[], typeId: string | null): CustomField[] {
  return fields.filter((f) => f.issueTypeId == null || f.issueTypeId === typeId);
}
