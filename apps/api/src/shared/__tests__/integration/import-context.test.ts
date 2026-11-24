import { beforeEach, describe, expect, it } from 'bun:test';
import { db, webhookDelivery } from '@repo/db';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createTeam,
  createWebhook,
  gqlData,
  signUpAs,
  statesByType,
} from '../../../__tests__/helpers/graphql';
import { ORIGIN } from '../../../__tests__/helpers/oauth';
import { upsertLinkAttachment } from '../../../attachments/store';
import { createComment } from '../../../comments/store';
import { createIssue } from '../../../issues/store';
import { createLabel } from '../../../labels/store';
import { getTeamByKey } from '../../../teams/store';
import { currentImport, runAsImport } from '../../workflow-context';

// An import is a system change: inside runAsImport no workflow rule runs, no
// notification is written and no webhook delivery of any kind is queued, while the
// issue's history and its subscribers are kept.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function plugin(as: TestUser, path: string, body: Json): Promise<Json> {
  const res = await app.handle(
    new Request(`http://localhost/api/auth/instance/${path}`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: as.cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  const member = await signUpAs('member', { name: 'Ann' });
  await addMember(owner, eng.team.id, member.userId);
  await createWebhook(owner, {
    url: 'https://hooks.example.com/in',
    resourceTypes: ['Issue', 'Comment', 'Attachment', 'IssueLabel'],
    teamId: eng.team.id,
  });
  // A rule that would raise the priority of every new issue.
  await plugin(owner, 'workflows/create', {
    teamId: eng.team.id,
    name: 'Prioritise',
    trigger: 'entityCreated',
    activities: [{ type: 'setPriority', priority: 1 }],
  });
  const team = (await getTeamByKey('ENG'))!;
  return { owner, member, team, states: statesByType(eng) };
}

beforeEach(async () => {
  await resetDb();
});

describe('import context', () => {
  it('exposes the running import only inside runAsImport', async () => {
    expect(currentImport()).toBeUndefined();
    const seen = await runAsImport('imp-1', async () => currentImport());
    expect(seen).toBe('imp-1');
    expect(currentImport()).toBeUndefined();
  });

  it('writes no notification or webhook and runs no rule, but keeps history and subscribers', async () => {
    const s = await setup();
    const issueId = await runAsImport('imp-1', async () => {
      const label = await createLabel({
        teamId: s.team.id,
        name: 'Imported',
        actorUserId: s.owner.userId,
      });
      const created = await createIssue(
        s.team,
        {
          stateId: s.states.unstarted,
          title: 'From GitHub',
          priority: 4,
          assigneeUserId: s.member.userId,
          labelIds: [label.id],
        },
        s.owner.userId,
      );
      await createComment({
        parent: { issueId: created.id },
        body: 'An old comment mentioning @Ann',
        actorUserId: s.owner.userId,
      });
      await upsertLinkAttachment(
        { issueId: created.id, url: 'https://github.com/acme/app/issues/1', title: 'GitHub #1' },
        s.owner.userId,
      );
      return created.id;
    });

    expect(await db.select().from(webhookDelivery)).toEqual([]);
    // Webhook deliveries are only visible as rows; the inbox is read through GraphQL.
    const inbox = await gqlData(s.member, `{ notifications { nodes { id } } }`);
    expect(inbox.notifications.nodes).toEqual([]);

    const data = await gqlData(
      s.owner,
      `query ($id: String!) { issue(id: $id) {
        priority history { nodes { botActor { id } } } subscribers { nodes { id } } } }`,
      { id: issueId },
    );
    // The rule did not run: the priority is the imported one.
    expect(data.issue.priority).toBe(4);
    expect(data.issue.history.nodes.length).toBeGreaterThan(0);
    expect(data.issue.subscribers.nodes.map((u: Json) => u.id).sort()).toEqual(
      [s.owner.userId, s.member.userId].sort(),
    );
  });
});
