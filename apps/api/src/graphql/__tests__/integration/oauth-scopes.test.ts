import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { createClient, obtainTokens } from '../../../__tests__/helpers/oauth';
import { createTeam, signUpAs } from '../../../__tests__/helpers/graphql';

// An OAuth token carries Linear's scopes: queries need `read`; mutations need
// `write`, except creating an issue (`issues:create`) and a comment
// (`comments:create`); admin operations need `admin` on top of the user's own rights.
// Sessions and API keys keep full access.

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const ISSUE_CREATE = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id } }
}`;
const ISSUE_UPDATE = `mutation($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success }
}`;
const COMMENT_CREATE = `mutation($input: CommentCreateInput!) {
  commentCreate(input: $input) { success }
}`;
const CHANGE_ROLE = `mutation($id: String!, $role: UserRoleType!) {
  userChangeRole(id: $id, role: $role) { success }
}`;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const client = await createClient(owner.cookie);
  const created = await gql({ cookie: owner.cookie }, ISSUE_CREATE, {
    input: { teamId: 'MKT', title: 'First' },
  });
  const issueId = (created.body.data?.issueCreate as { issue: { id: string } }).issue.id;
  return { owner, client, issueId };
}

const code = (res: Awaited<ReturnType<typeof gql>>) => res.body.errors?.[0]?.extensions?.code;

describe('oauth scopes on graphql', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lets a read token query and refuses every mutation', async () => {
    const { owner, client, issueId } = await setup();
    const { access_token } = await obtainTokens(owner.cookie, client, 'read');
    const read = await gql(bearer(access_token), '{ issue(id: "' + issueId + '") { title } }');
    expect((read.body.data?.issue as { title: string }).title).toBe('First');
    const res = await gql(bearer(access_token), ISSUE_UPDATE, {
      id: issueId,
      input: { title: 'Changed' },
    });
    expect(code(res)).toBe('FORBIDDEN');
    expect(res.body.errors?.[0]?.message).toContain('write');
    const create = await gql(bearer(access_token), ISSUE_CREATE, {
      input: { teamId: 'MKT', title: 'Second' },
    });
    expect(code(create)).toBe('FORBIDDEN');
  });

  it('lets issues:create create an issue but not update one', async () => {
    const { owner, client, issueId } = await setup();
    const { access_token } = await obtainTokens(owner.cookie, client, 'read,issues:create');
    const create = await gql(bearer(access_token), ISSUE_CREATE, {
      input: { teamId: 'MKT', title: 'Second' },
    });
    expect((create.body.data?.issueCreate as { success: boolean }).success).toBe(true);
    const update = await gql(bearer(access_token), ISSUE_UPDATE, {
      id: issueId,
      input: { title: 'Changed' },
    });
    expect(code(update)).toBe('FORBIDDEN');
    const comment = await gql(bearer(access_token), COMMENT_CREATE, {
      input: { issueId, body: 'Hi' },
    });
    expect(code(comment)).toBe('FORBIDDEN');
  });

  it('always grants read, as Linear does', async () => {
    const { owner, client } = await setup();
    const { access_token, scope } = await obtainTokens(owner.cookie, client, 'issues:create');
    expect(scope.split(' ')).toContain('read');
    const teams = await gql(bearer(access_token), '{ teams { nodes { key } } }');
    expect(teams.body.errors).toBeUndefined();
    expect((teams.body.data?.teams as { nodes: { key: string }[] }).nodes[0]!.key).toBe('MKT');
  });

  it('lets comments:create create a comment', async () => {
    const { owner, client, issueId } = await setup();
    const { access_token } = await obtainTokens(owner.cookie, client, 'read,comments:create');
    const comment = await gql(bearer(access_token), COMMENT_CREATE, {
      input: { issueId, body: 'Hi' },
    });
    expect((comment.body.data?.commentCreate as { success: boolean }).success).toBe(true);
  });

  it('lets write do both', async () => {
    const { owner, client, issueId } = await setup();
    const { access_token } = await obtainTokens(owner.cookie, client, 'read,write');
    const update = await gql(bearer(access_token), ISSUE_UPDATE, {
      id: issueId,
      input: { title: 'Changed' },
    });
    expect((update.body.data?.issueUpdate as { success: boolean }).success).toBe(true);
  });

  it('needs the admin scope for an admin operation, and the rights too', async () => {
    const { owner, client } = await setup();
    const member = await signUpAs('member', { name: 'Ann' });
    const other = await signUpAs('member', { name: 'Ben' });

    const plain = await obtainTokens(owner.cookie, client, 'read,write');
    const refused = await gql(bearer(plain.access_token), CHANGE_ROLE, {
      id: member.userId,
      role: 'admin',
    });
    expect(code(refused)).toBe('FORBIDDEN');

    const admin = await obtainTokens(owner.cookie, client, 'read,write,admin');
    const allowed = await gql(bearer(admin.access_token), CHANGE_ROLE, {
      id: member.userId,
      role: 'admin',
    });
    expect((allowed.body.data?.userChangeRole as { success: boolean }).success).toBe(true);

    // A member's token with the admin scope still has a member's rights.
    const memberToken = await obtainTokens(other.cookie, client, 'read,write,admin');
    const notAdmin = await gql(bearer(memberToken.access_token), CHANGE_ROLE, {
      id: member.userId,
      role: 'user',
    });
    expect(code(notAdmin)).toBe('FORBIDDEN');
  });

  it('keeps full access for a session', async () => {
    const { owner, issueId } = await setup();
    const update = await gql({ cookie: owner.cookie }, ISSUE_UPDATE, {
      id: issueId,
      input: { title: 'Changed' },
    });
    expect((update.body.data?.issueUpdate as { success: boolean }).success).toBe(true);
  });
});
