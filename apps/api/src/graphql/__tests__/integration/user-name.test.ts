import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createTeam,
  createWebhook,
  gqlData,
} from '../../../__tests__/helpers/graphql';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// A magic-link sign-up has no name. Like Linear, such an account is named after its
// email's local part until the person sets a name.

describe('User name of an account without one', () => {
  beforeEach(resetDb);

  it('reads as the email local part', async () => {
    const owner = await signUpTestUser({ email: 'pat.owner@example.com', name: '' });
    const data = await gqlData(owner, '{ viewer { name displayName initials } }');
    expect(data.viewer).toEqual({ name: 'pat.owner', displayName: 'pat.owner', initials: 'P' });
  });

  it('keeps a name that is set', async () => {
    const owner = await signUpTestUser({ name: 'Pat Owner' });
    const data = await gqlData(owner, '{ viewer { name displayName } }');
    expect(data.viewer).toEqual({ name: 'Pat Owner', displayName: 'Pat Owner' });
  });
});

describe('the email local part wherever a name is used', () => {
  beforeEach(resetDb);

  it('matches the local part in name filters', async () => {
    const owner = await signUpTestUser({ email: 'pat.owner@example.com', name: '' });
    const view = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
    await createIssue(owner, {
      teamId: view.team.id,
      stateId: view.states[0]!.id,
      assigneeId: owner.userId,
    });
    const data = await gqlData(
      owner,
      `{ issues(filter: { assignee: { name: { eq: "pat.owner" } } }) { nodes { id } }
         team(id: "${view.team.id}") { members(filter: { displayName: { eq: "pat.owner" } }) { nodes { id } } } }`,
    );
    expect(data.issues.nodes).toHaveLength(1);
    expect(data.team.members.nodes).toEqual([{ id: owner.userId }]);
  });

  it('names the actor and assignee by the local part in webhook payloads', async () => {
    const owner = await signUpTestUser({ email: 'pat.owner@example.com', name: '' });
    const view = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
    const hook = await createWebhook(owner, {
      url: 'https://example.com/hook',
      resourceTypes: ['Issue'],
      teamId: 'ENG',
    });
    await createIssue(owner, {
      teamId: view.team.id,
      stateId: view.states[0]!.id,
      assigneeId: owner.userId,
    });
    const [payload] = (await webhookDeliveries(hook.id)).data!.items.map(
      (d) => d.payload as { actor: { name: string }; data: { assignee: { name: string } | null } },
    );
    expect(payload!.actor.name).toBe('pat.owner');
    expect(payload!.data.assignee?.name).toBe('pat.owner');
  });
});
