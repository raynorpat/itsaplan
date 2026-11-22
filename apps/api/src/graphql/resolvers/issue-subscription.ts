import { db, user } from '@repo/db';
import { inArray, sql } from 'drizzle-orm';
import {
  nonMembers,
  subscribe,
  subscribedMembers,
  unsubscribe,
} from '../../notifications/subscriptions';
import { assertTeamAccess } from '../../shared/access';
import { UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import type { PageArgs } from '../connection';
import { gqlError } from '../errors';
import { findIssue, issueById } from './issue';
import { guard, lastSyncId } from './mutations';
import { listUsers } from './team';

// Linear's issue subscribers over GraphQL. Reading or changing them needs read
// access to the issue; a subscriber must be a member of the issue's team.

type Args = { id: string; userId?: string | null; userEmail?: string | null };

const notSubscribable = () =>
  gqlError('INVALID_INPUT', "The subscriber must be a member of the issue's team");

// The user an issueSubscribe / issueUnsubscribe call names: userId, else userEmail,
// else the viewer.
async function targetUser(args: Args, ctx: GraphQLContext): Promise<string> {
  if (args.userId) {
    if (!UUID_RE.test(args.userId)) throw gqlError('INVALID_INPUT', 'userId is not a valid id');
    return args.userId;
  }
  if (args.userEmail) {
    const [row] = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = lower(${args.userEmail})`);
    // Same answer as a user outside the team, so the call does not reveal which
    // emails have accounts.
    if (!row) throw notSubscribable();
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
        if ((await nonMembers(found.id, [userId])).length) throw notSubscribable();
        await subscribe(found.id, [userId]);
        return payload(found.id);
      }),
    issueUnsubscribe: (_: unknown, args: Args, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findIssue(args.id, ctx.user.id);
        const userId = await targetUser(args, ctx);
        // Taking someone else off an issue needs a team manager.
        if (userId !== ctx.user.id) await assertTeamAccess(found.teamId, ctx.user, 'manage');
        await unsubscribe(found.id, userId);
        return payload(found.id);
      }),
  },
};
