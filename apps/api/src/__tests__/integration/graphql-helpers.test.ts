import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import {
  addMember,
  createComment,
  createCycle,
  createDocument,
  createInitiative,
  createIssue,
  createLabel,
  createProject,
  createState,
  createTeam,
  createView,
  createWebhook,
  gqlData,
  makePrivate,
  statesByType,
  teamView,
  updateTeam,
} from '../helpers/graphql';

// The GraphQL setup helpers the API tests build their data with: each creates
// through `/graphql` and returns the ids a test needs.

describe('graphql setup helpers', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a team with its states, members and labels', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const member = await signUpTestUser({ name: 'Ann' });
    const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
    expect(view.team.key).toBe('MKT');
    expect(view.team.private).toBe(false);
    const types = statesByType(view);
    expect(types.backlog).toBeTruthy();
    expect(types.started).toBeTruthy();

    await addMember(owner, 'MKT', member.userId);
    await makePrivate(owner, 'MKT');
    const label = await createLabel(owner, { name: 'Bug', teamId: view.team.id });
    const state = await createState(owner, {
      teamId: view.team.id,
      name: 'Review',
      type: 'started',
    });

    const after = await teamView(owner, 'MKT');
    expect(after.team.private).toBe(true);
    expect(after.members.map((m) => m.userId)).toContain(member.userId);
    expect(after.labels.map((l) => l.id)).toContain(label.id);
    expect(after.states.map((s) => s.id)).toContain(state.id);

    const privateTeam = await createTeam(owner, { key: 'SEC', private: true });
    expect(privateTeam.team.private).toBe(true);
  });

  it('creates issues, comments, projects, cycles, documents, initiatives, views and webhooks', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const view = await createTeam(owner, { key: 'MKT' });
    const issue = await createIssue(owner, { teamId: 'MKT', title: 'Ship' });
    expect(issue.identifier).toBe('MKT-1');
    expect(issue.sequenceNumber).toBe(1);
    expect(issue.teamId).toBe(view.team.id);

    const comment = await createComment(owner, { issueId: issue.id, body: 'Hello' });
    expect(comment.body).toBe('Hello');

    const project = await createProject(owner, { name: 'Launch', teamIds: ['MKT'] });
    expect(project.name).toBe('Launch');

    await updateTeam(owner, 'MKT', { cyclesEnabled: true });
    const cycle = await createCycle(owner, {
      teamId: 'MKT',
      startsAt: '2030-01-01T00:00:00.000Z',
      endsAt: '2030-01-15T00:00:00.000Z',
    });
    expect(cycle.number).toBeGreaterThan(0);

    const doc = await createDocument(owner, { title: 'Spec', projectId: project.id });
    expect(doc.title).toBe('Spec');

    const initiative = await createInitiative(owner, { name: 'Q1' });
    expect(initiative.name).toBe('Q1');

    const customView = await createView(owner, { name: 'Mine', teamId: view.team.id });
    expect(customView.name).toBe('Mine');

    const hook = await createWebhook(owner, {
      url: 'https://hooks.example.com/in',
      teamId: view.team.id,
      resourceTypes: ['Issue'],
    });
    expect(hook.id).toBeTruthy();

    const data = await gqlData(owner, '{ issues { nodes { id } } }');
    expect(data.issues.nodes).toHaveLength(1);
  });

  it('throws with the API message when a step fails', async () => {
    const owner = await signUpTestUser();
    await expect(createIssue(owner, { teamId: 'NOPE' })).rejects.toThrow('GraphQL failed');
  });
});
