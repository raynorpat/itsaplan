import { beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createLabel,
  createTeam,
  gqlData,
  signUpAs,
  statesByType,
  teamView,
  updateTeam,
} from '../../../__tests__/helpers/graphql';
import { bearer, createClient, install, ORIGIN } from '../../../__tests__/helpers/oauth';

// Workflow automation rules (Linear's WorkflowDefinition) managed through the
// instance plugin under /api/auth/instance/workflows*: who may list and edit them,
// and the validation of their trigger, conditions and actions.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function call(
  path: string,
  init: { cookie?: string; body?: unknown; origin?: string | null; headers?: Json } = {},
) {
  const headers = new Headers(init.headers ?? {});
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return app.handle(
    new Request(`http://localhost/api/auth/instance/${path}`, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

async function ok(res: Response): Promise<Json> {
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

const list = async (as: TestUser, teamId: string, extra = '') =>
  (await ok(await call(`workflows?teamId=${teamId}${extra}`, { cookie: as.cookie })))
    .workflows as Json[];

interface Setup {
  owner: TestUser; // workspace owner, team owner of ENG
  member: TestUser; // plain member of ENG
  teamId: string;
  stateId: string;
  otherTeamId: string;
}

async function setup(): Promise<Setup> {
  const owner = await signUpTestUser({ name: 'Owner' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  const other = await createTeam(owner, { key: 'OPS', name: 'Operations' });
  const member = await signUpAs('member', { name: 'Ann' });
  await addMember(owner, eng.team.id, member.userId);
  return {
    owner,
    member,
    teamId: eng.team.id,
    stateId: statesByType(eng).started!,
    otherTeamId: other.team.id,
  };
}

const rule = (s: Setup, extra: Json = {}) => ({
  teamId: s.teamId,
  name: 'Start bugs',
  trigger: 'entityCreated',
  conditions: { priority: { eq: 1 } },
  activities: [{ type: 'setState', stateId: s.stateId }],
  ...extra,
});

const create = (as: TestUser, body: Json) => call('workflows/create', { cookie: as.cookie, body });

describe('workflow rules', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lets a team owner create, list, get, update, reorder, archive and delete a rule', async () => {
    const s = await setup();
    const created = (await ok(await create(s.owner, rule(s)))).workflow;
    expect(created).toMatchObject({
      name: 'Start bugs',
      teamId: s.teamId,
      type: 'automation',
      triggerType: 'issue',
      trigger: 'entityCreated',
      activationMode: null,
      enabled: true,
      editAccess: 'teamOwners',
      ownerId: s.owner.userId,
      creatorId: s.owner.userId,
      stats: { runs: 0 },
    });

    const second = (
      await ok(
        await create(
          s.owner,
          rule(s, {
            name: 'Label urgent',
            trigger: 'entityUpdated',
            conditions: { priority: { eq: 1 } },
          }),
        ),
      )
    ).workflow;
    expect(second.activationMode).toBe('conditionsStartedMatching');
    expect((await list(s.owner, s.teamId)).map((w) => w.name)).toEqual([
      'Start bugs',
      'Label urgent',
    ]);

    const got = await ok(await call(`workflow?id=${created.id}`, { cookie: s.owner.cookie }));
    expect(got.workflow.id).toBe(created.id);

    const updated = await ok(
      await call('workflows/update', {
        cookie: s.owner.cookie,
        body: { id: created.id, name: 'Start urgent bugs', enabled: false },
      }),
    );
    expect(updated.workflow).toMatchObject({ name: 'Start urgent bugs', enabled: false });
    expect(updated.workflow.lastUpdatedById).toBe(s.owner.userId);

    await ok(
      await call('workflows/enable', {
        cookie: s.owner.cookie,
        body: { id: created.id, enabled: true },
      }),
    );
    await ok(
      await call('workflows/reorder', {
        cookie: s.owner.cookie,
        body: { id: second.id, sortOrder: created.sortOrder - 1 },
      }),
    );
    expect((await list(s.owner, s.teamId)).map((w) => w.name)).toEqual([
      'Label urgent',
      'Start urgent bugs',
    ]);

    const archived = await ok(
      await call('workflows/archive', { cookie: s.owner.cookie, body: { id: created.id } }),
    );
    expect(archived.workflow.archivedAt).not.toBeNull();
    expect((await list(s.owner, s.teamId)).map((w) => w.name)).toEqual(['Label urgent']);
    expect((await list(s.owner, s.teamId, '&includeArchived=true')).length).toBe(2);
    await ok(
      await call('workflows/unarchive', { cookie: s.owner.cookie, body: { id: created.id } }),
    );
    expect((await list(s.owner, s.teamId)).length).toBe(2);

    await ok(await call('workflows/delete', { cookie: s.owner.cookie, body: { id: created.id } }));
    expect((await call(`workflow?id=${created.id}`, { cookie: s.owner.cookie })).status).toBe(404);
  });

  it('lets a workspace admin who is not in the team manage its rules', async () => {
    const s = await setup();
    const admin = await signUpAs('admin', { name: 'Ada' });
    expect((await create(admin, rule(s))).status).toBe(200);
  });

  it('refuses a plain member under the default edit access and allows them under everyone', async () => {
    const s = await setup();
    // A team owner exists (the creator), so the member does not manage the team.
    expect((await create(s.member, rule(s))).status).toBe(403);
    const defaultRule = (await ok(await create(s.owner, rule(s)))).workflow;
    const res = await call('workflows/update', {
      cookie: s.member.cookie,
      body: { id: defaultRule.id, name: 'Mine now' },
    });
    expect(res.status).toBe(403);

    const open = (await ok(await create(s.owner, rule(s, { editAccess: 'everyone' })))).workflow;
    const edited = await call('workflows/update', {
      cookie: s.member.cookie,
      body: { id: open.id, name: 'Edited by Ann' },
    });
    expect((await ok(edited)).workflow.name).toBe('Edited by Ann');
    // Only team managers change who may edit.
    const widen = await call('workflows/update', {
      cookie: s.member.cookie,
      body: { id: open.id, editAccess: 'owner' },
    });
    expect(widen.status).toBe(403);
    // The member can list the team's rules.
    expect((await list(s.member, s.teamId)).length).toBe(2);
  });

  it('limits a workspaceAdmins rule to admins and owners', async () => {
    const s = await setup();
    const teamOwner = await signUpAs('member', { name: 'Tom' });
    await addMember(s.owner, s.teamId, teamOwner.userId);
    await ok(
      await call('team-owner', {
        cookie: s.owner.cookie,
        body: { teamId: s.teamId, userId: teamOwner.userId, owner: true },
      }),
    );
    const w = (await ok(await create(s.owner, rule(s, { editAccess: 'workspaceAdmins' }))))
      .workflow;
    const res = await call('workflows/update', {
      cookie: teamOwner.cookie,
      body: { id: w.id, name: 'Nope' },
    });
    expect(res.status).toBe(403);
  });

  it("lets the rule's owner and admins edit an owner-only rule, and no one else", async () => {
    const s = await setup();
    const teamOwner = await signUpAs('member', { name: 'Tom' });
    await addMember(s.owner, s.teamId, teamOwner.userId);
    await ok(
      await call('team-owner', {
        cookie: s.owner.cookie,
        body: { teamId: s.teamId, userId: teamOwner.userId, owner: true },
      }),
    );
    // The member becomes the owner by changing the actions of an open rule; a team
    // manager then limits it to its owner.
    const open = (await ok(await create(s.owner, rule(s, { editAccess: 'everyone' })))).workflow;
    await ok(
      await call('workflows/update', {
        cookie: s.member.cookie,
        body: { id: open.id, activities: [{ type: 'setPriority', priority: 2 }] },
      }),
    );
    const w = (
      await ok(
        await call('workflows/update', {
          cookie: s.owner.cookie,
          body: { id: open.id, editAccess: 'owner' },
        }),
      )
    ).workflow;
    expect(w.ownerId).toBe(s.member.userId);

    const byOwner = await call('workflows/update', {
      cookie: s.member.cookie,
      body: { id: w.id, name: 'Owned' },
    });
    expect((await ok(byOwner)).workflow.name).toBe('Owned');
    const byTeamOwner = await call('workflows/update', {
      cookie: teamOwner.cookie,
      body: { id: w.id, name: 'Taken' },
    });
    expect(byTeamOwner.status).toBe(403);
    const byAdmin = await call('workflows/update', {
      cookie: s.owner.cookie,
      body: { id: w.id, name: 'Admin edit' },
    });
    expect(byAdmin.status).toBe(200);
  });

  it("refuses setting someone else as a rule's owner, even for an admin", async () => {
    const s = await setup();
    const onCreate = await create(s.owner, rule(s, { ownerId: s.member.userId }));
    expect(onCreate.status).toBe(403);
    const w = (await ok(await create(s.owner, rule(s, { ownerId: s.owner.userId })))).workflow;
    expect(w.ownerId).toBe(s.owner.userId);
    const onUpdate = await call('workflows/update', {
      cookie: s.owner.cookie,
      body: { id: w.id, ownerId: s.member.userId },
    });
    expect(onUpdate.status).toBe(403);
    expect(
      (await ok(await call(`workflow?id=${w.id}`, { cookie: s.owner.cookie }))).workflow.ownerId,
    ).toBe(s.owner.userId);
  });

  it("makes whoever changes a rule's conditions or actions its owner", async () => {
    const s = await setup();
    const w = (await ok(await create(s.owner, rule(s, { editAccess: 'everyone' })))).workflow;
    const byMember = await ok(
      await call('workflows/update', {
        cookie: s.member.cookie,
        body: { id: w.id, activities: [{ type: 'setPriority', priority: 2 }] },
      }),
    );
    expect(byMember.workflow.ownerId).toBe(s.member.userId);
    // A change to anything else keeps the owner.
    const renamed = await ok(
      await call('workflows/update', {
        cookie: s.owner.cookie,
        body: { id: w.id, name: 'Renamed' },
      }),
    );
    expect(renamed.workflow.ownerId).toBe(s.member.userId);
    const byOwner = await ok(
      await call('workflows/update', {
        cookie: s.owner.cookie,
        body: { id: w.id, conditions: { priority: { eq: 2 } } },
      }),
    );
    expect(byOwner.workflow.ownerId).toBe(s.owner.userId);
  });

  it('refuses a guest, even on a rule everyone may edit', async () => {
    const s = await setup();
    const guest = await signUpAs('guest', { name: 'Gus' });
    await addMember(s.owner, s.teamId, guest.userId);
    expect((await create(guest, rule(s))).status).toBe(403);
    const open = (await ok(await create(s.owner, rule(s, { editAccess: 'everyone' })))).workflow;
    const res = await call('workflows/update', {
      cookie: guest.cookie,
      body: { id: open.id, name: 'Guest edit' },
    });
    expect(res.status).toBe(403);
    expect(
      (await call('workflows/delete', { cookie: guest.cookie, body: { id: open.id } })).status,
    ).toBe(403);
  });

  it('refuses an app user', async () => {
    const s = await setup();
    const client = await createClient(s.owner.cookie);
    const tokens = await install(s.owner.cookie, client, { scope: 'read,write,app:assignable' });
    const res = await call('workflows/create', {
      body: rule(s),
      headers: bearer(tokens.access_token),
    });
    expect(res.status).toBe(401);
    const listed = await call(`workflows?teamId=${s.teamId}`, {
      headers: bearer(tokens.access_token),
    });
    expect(listed.status).toBe(401);
  });

  it("does not show a private team's rules to someone outside it", async () => {
    const s = await setup();
    await updateTeam(s.owner, s.teamId, { private: true });
    await ok(await create(s.owner, rule(s)));
    const outsider = await signUpAs('member', { name: 'Olly' });
    const res = await call(`workflows?teamId=${s.teamId}`, { cookie: outsider.cookie });
    expect(res.status).toBe(404);
    expect((await create(outsider, rule(s))).status).toBe(404);
  });

  it('refuses a cookie POST from another origin', async () => {
    const s = await setup();
    expect(
      (await call('workflows/create', { cookie: s.owner.cookie, body: rule(s), origin: null }))
        .status,
    ).toBe(403);
    expect(
      (
        await call('workflows/create', {
          cookie: s.owner.cookie,
          body: rule(s),
          origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
  });

  it('refuses an unsupported type, trigger type, trigger or activation mode', async () => {
    const s = await setup();
    for (const extra of [
      { type: 'triage' },
      { triggerType: 'project' },
      { trigger: 'commentAdded' },
      { trigger: 'entityUpdated', activationMode: 'anyUpdate' },
      { trigger: 'entityCreated', activationMode: 'conditionsStartedMatching' },
      { editAccess: 'nobody' },
      { name: '  ' },
    ]) {
      const res = await create(s.owner, rule(s, extra));
      expect(res.status).toBe(400);
    }
  });

  it('refuses conditions with an unknown filter field, and empty conditions on an update rule', async () => {
    const s = await setup();
    expect((await create(s.owner, rule(s, { conditions: { flavour: { eq: 'x' } } }))).status).toBe(
      400,
    );
    expect(
      (await create(s.owner, rule(s, { trigger: 'entityUpdated', conditions: {} }))).status,
    ).toBe(400);
    // An empty condition on a create rule matches every new issue.
    expect((await create(s.owner, rule(s, { conditions: {} }))).status).toBe(200);
  });

  it("refuses actions that reach outside the rule's team", async () => {
    const s = await setup();
    const other = await teamView(s.owner, 'OPS');
    const otherLabel = await createLabel(s.owner, { name: 'Ops only', teamId: s.otherTeamId });
    const workspaceLabel = await createLabel(s.owner, { name: 'Everywhere' });
    await updateTeam(s.owner, s.otherTeamId, { cyclesEnabled: true });
    const cycles = await gqlData(
      s.owner,
      `query ($id: String!) { team(id: $id) { cycles(first: 5) { nodes { id } } } }`,
      { id: s.otherTeamId },
    );
    const otherCycleId = cycles.team.cycles.nodes[0].id;

    const refused: Json[][] = [
      [{ type: 'setState', stateId: statesByType(other).started }],
      [{ type: 'addLabels', labelIds: [otherLabel.id] }],
      [{ type: 'setCycle', cycleId: otherCycleId }],
      [{ type: 'setPriority', priority: 5 }],
      [{ type: 'addComment', body: '' }],
      [{ type: 'explode' }],
      [],
    ];
    for (const activities of refused)
      expect((await create(s.owner, rule(s, { activities }))).status).toBe(400);

    const accepted = await create(
      s.owner,
      rule(s, {
        activities: [
          { type: 'addLabels', labelIds: [workspaceLabel.id] },
          { type: 'setPriority', priority: 2 },
          { type: 'setAssignee', userId: s.member.userId },
          { type: 'addComment', body: 'Picked up by the workflow.' },
        ],
      }),
    );
    expect(accepted.status).toBe(200);
  });

  it('refuses an assignee outside the team and a delegate that cannot be assigned', async () => {
    const s = await setup();
    const outsider = await signUpAs('member', { name: 'Olly' });
    expect(
      (
        await create(
          s.owner,
          rule(s, { activities: [{ type: 'setAssignee', userId: outsider.userId }] }),
        )
      ).status,
    ).toBe(400);

    const client = await createClient(s.owner.cookie);
    const tokens = await install(s.owner.cookie, client, { scope: 'read,write' });
    const appUser = await gqlData({ headers: bearer(tokens.access_token) }, `{ viewer { id } }`);
    const res = await create(
      s.owner,
      rule(s, { activities: [{ type: 'setDelegate', appUserId: appUser.viewer.id }] }),
    );
    expect(res.status).toBe(400);
  });

  it('matches no issue by the creating workflow, since workflows create none', async () => {
    const s = await setup();
    await gqlData(
      s.owner,
      `mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { success } }`,
      { input: { teamId: s.teamId, title: 'One' } },
    );
    const byWorkflow = await gqlData(
      s.owner,
      `query ($f: IssueFilter) { issues(filter: $f) { nodes { id } } }`,
      {
        f: {
          sourceMetadata: { workflowDefinitionId: { eq: '00000000-0000-4000-8000-000000000000' } },
        },
      },
    );
    expect(byWorkflow.issues.nodes).toHaveLength(0);
    const noSource = await gqlData(
      s.owner,
      `query ($f: IssueFilter) { issues(filter: $f) { nodes { id } } }`,
      { f: { sourceMetadata: { null: true } } },
    );
    expect(noSource.issues.nodes).toHaveLength(1);
  });
});
