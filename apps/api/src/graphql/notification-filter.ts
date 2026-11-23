import { notification } from '@repo/db';
import { sql, type SQL } from 'drizzle-orm';
import { compare, compareId, filterSql, type FieldHandlers } from './filter';

// NotificationFilter as SQL over the notification table: id, type (Linear's names),
// createdAt, updatedAt, archivedAt, and / or. subscriptionType and anything else is
// INVALID_INPUT.

// The stored notification type as Linear's type name.
export const linearType = sql`CASE ${notification.type}
  WHEN 'assigned' THEN 'issueAssignedToYou'
  WHEN 'mentioned' THEN 'issueCommentMention'
  WHEN 'commented' THEN 'issueNewComment'
  WHEN 'state_changed' THEN 'issueStatusChanged'
  WHEN 'agent_needs_input' THEN 'agentSessionNeedsInput'
  WHEN 'agent_responded' THEN 'agentSessionResponse'
END`;

const handlers: FieldHandlers = {
  id: (v, p) => compareId(notification.id, v, p),
  type: (v, p) => compare(linearType, v, p),
  createdAt: (v, p) => compare(notification.createdAt, v, p),
  updatedAt: (v, p) => compare(notification.updatedAt, v, p),
  archivedAt: (v, p) => compare(notification.archivedAt, v, p),
};

export function notificationFilterSql(filter: unknown): SQL | undefined {
  return filterSql(filter, handlers);
}
