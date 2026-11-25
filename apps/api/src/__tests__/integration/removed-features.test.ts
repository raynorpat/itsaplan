import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { addMember, createComment, createIssue, createTeam, gqlData } from '../helpers/graphql';
import { createApiKey } from '../helpers/linear';
import { mcp } from '../helpers/mcp';
import { db, user } from '@repo/db';
import { eq } from 'drizzle-orm';

// Features Linear does not have are removed: no MCP tool description mentions them
// (their old REST paths are in routes.test.ts).

async function setup() {
  const owner = await signUpTestUser();
  await createTeam({ cookie: owner.cookie }, { key: 'MKT', name: 'Marketing' });
  const issue = await createIssue({ cookie: owner.cookie }, { teamId: 'MKT', title: 'T' });
  return { cookie: owner.cookie, issueId: issue.id, userId: owner.userId };
}

describe('removed features', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('keeps a comment whose author was deleted', async () => {
    const { cookie, issueId } = await setup();
    const member = await signUpTestUser({ name: 'Gone' });
    await addMember({ cookie }, 'MKT', member.userId);
    const comment = await createComment({ cookie: member.cookie }, { issueId, body: 'Hello' });
    await db.delete(user).where(eq(user.id, member.userId));
    const data = await gqlData(
      { cookie },
      `{ comment(id: "${comment.id}") { id body user { id } } }`,
    );
    expect(data).toEqual({ comment: { id: comment.id, body: 'Hello', user: null } });
  });

  it('documents no removed feature in the MCP tool descriptions', async () => {
    const { cookie } = await setup();
    const key = await createApiKey(cookie);
    const res = await mcp(key, 'tools/list');
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.result);
    for (const phrase of ['issue types', 'custom fields', 'AI agent', 'note board'])
      expect(text).not.toContain(phrase);
  });
});
