import type { WorkspaceRole } from '@/types/workspace';

// "Send to requesters" on a posted update: its author or a workspace admin or owner may
// send it, once; guests never (the API's rule).
export function canSendToRequesters(input: {
  shared: boolean;
  own: boolean;
  role: WorkspaceRole;
}): boolean {
  if (input.shared || input.role === 'guest') return false;
  return input.own || input.role === 'admin' || input.role === 'owner';
}
