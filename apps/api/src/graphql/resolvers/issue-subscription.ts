import { db, user } from '@repo/db';
import { inArray, sql } from 'drizzle-orm';
import {
  nonMembers,
  subscribe,
  subscribedMembers,
  unsubscribe,
} from '../../notifications/subscriptions';
import type { GraphQLContext } from '../context';
import type { PageArgs } from '../connection';
import { gqlError } from '../errors';
import { findIssue, issueById } from './issue';
import { guard, lastSyncId } from './mutations';
import { listUsers } from './team';

// Linear's issue subscribers over GraphQL. Reading or changing them needs read
// access to the issue; a subscriber must be a member of the issue's team.

type Args = { id: string; userId?: string | null; userEmail?: string | null };

// The user an issueSubscribe / issueUnsubscribe call names: userId, else userEmail,
// else the viewer.
async function targetUser(args: Args, ctx: GraphQLContext): Promise<string> {
  if (args.userId) return args.userId;
  if (args.userEmail) {
    const [row] = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = lower(${args.userEmail})`);
    if (!row) throw gqlError('INVALID_INPUT', `No user with email ${args.userEmail}`);
    return row.id;
  }
  return ctx.user.id;
}

const payload = async (issueId: string) => ({
  success: true,
  lastSyncId: lastSyncId(),
  issue: await issueById(issueId),
});

export const issueSubscriptionResolvers = {
  Issue: {
    subscribers: (i: { id: string }, args: PageArgs & { filter?: unknown }, ctx: GraphQLContext) =>
      listUsers(inArray(user.id, subscribedMembers(i.id)), args, ctx.user.id),
  },
  Mutation: {
    issueSubscribe: (_: unknown, args: Args, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findIssue(args.id, ctx.user.id);
        const userId = await targetUser(args, ctx);
        if ((await nonMembers(found.id, [userId])).length)
          throw gqlError('INVALID_INPUT', "The subscriber must be a member of the issue's team");
        await subscribe(found.id, [userId]);
        return payload(found.id);
      }),
    issueUnsubscribe: (_: unknown, args: Args, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findIssue(args.id, ctx.user.id);
        await unsubscribe(found.id, await targetUser(args, ctx));
        return payload(found.id);
      }),
  },
};
