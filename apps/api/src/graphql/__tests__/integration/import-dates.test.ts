import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createIssue, createTeam, gqlData, statesByType } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Linear's import fields: issueCreate's createdAt / completedAt and commentCreate's
// createdAt, open to every API caller with Linear's rules.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const codeOf = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  return { owner, teamId: eng.team.id as string, states: statesByType(eng) };
}

const CREATE = `mutation ($input: IssueCreateInput!) {
  issueCreate(input: $input) { issue { id createdAt completedAt history { nodes { createdAt } } } } }`;

beforeEach(async () => {
  await resetDb();
});

describe('import dates', () => {
  it('stores an issue creation date in the past', async () => {
    const s = await setup();
    const createdAt = ago(400);
    const data = await gqlData(s.owner, CREATE, {
      input: { teamId: s.teamId, title: 'Old', createdAt },
    });
    const issue = data.issueCreate.issue as Json;
    expect(issue.createdAt).toBe(createdAt);
    // The creation history entry reads as of the original date.
    expect(issue.history.nodes.map((h: Json) => h.createdAt)).toContain(createdAt);
  });

  it('stores a completion date for an issue created in a completed state', async () => {
    const s = await setup();
    const createdAt = ago(30);
    const completedAt = ago(10);
    const data = await gqlData(s.owner, CREATE, {
      input: {
        teamId: s.teamId,
        title: 'Done long ago',
        stateId: s.states.completed,
        createdAt,
        completedAt,
      },
    });
    expect(data.issueCreate.issue.completedAt).toBe(completedAt);
  });

  it('refuses dates in the future and a completion date that breaks the rules', async () => {
    const s = await setup();
    const future = new Date(Date.now() + DAY).toISOString();
    const cases: Json[] = [
      { createdAt: future },
      // completedAt needs createdAt.
      { stateId: s.states.completed, completedAt: ago(1) },
      // completedAt needs a completed state.
      { stateId: s.states.unstarted, createdAt: ago(5), completedAt: ago(1) },
      // completedAt not before createdAt.
      { stateId: s.states.completed, createdAt: ago(1), completedAt: ago(5) },
      // completedAt in the past.
      { stateId: s.states.completed, createdAt: ago(5), completedAt: future },
    ];
    for (const extra of cases) {
      const res = await gql({ cookie: s.owner.cookie }, CREATE, {
        input: { teamId: s.teamId, title: 'x', ...extra },
      });
      expect(codeOf(res)).toBe('INVALID_INPUT');
    }
  });

  it('stores a comment creation date in the past and refuses one in the future', async () => {
    const s = await setup();
    const issue = await createIssue(s.owner, { teamId: s.teamId, title: 'x' });
    const createdAt = ago(100);
    const query = `mutation ($input: CommentCreateInput!) {
      commentCreate(input: $input) { comment { createdAt } } }`;
    const data = await gqlData(s.owner, query, {
      input: { issueId: issue.id, body: 'old', createdAt },
    });
    expect(data.commentCreate.comment.createdAt).toBe(createdAt);
    const res = await gql({ cookie: s.owner.cookie }, query, {
      input: {
        issueId: issue.id,
        body: 'later',
        createdAt: new Date(Date.now() + DAY).toISOString(),
      },
    });
    expect(codeOf(res)).toBe('INVALID_INPUT');
  });
});
