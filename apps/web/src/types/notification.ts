import type { StateType } from '@/types/team';

// Inbox notifications. Each row is enriched with the issue and team it points at
// so the list renders without extra calls.
export type NotificationType =
  'assigned' | 'mentioned' | 'commented' | 'state_changed' | 'agent_needs_input' | 'agent_response';

export interface Notification {
  id: string;
  type: NotificationType;
  actorUserId: string | null;
  // The person who acted, or the workflow when actorWorkflow (Linear's ActorBot).
  actorName: string | null;
  actorWorkflow: boolean;
  readAt: string | null;
  snoozedUntil: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  issueId: string;
  issueSeq: number;
  issueTitle: string;
  issueStateType: StateType;
  teamId: string;
  teamKey: string;
  teamName: string;
}
