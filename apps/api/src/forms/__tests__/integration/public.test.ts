import { beforeEach, describe, expect, it } from 'bun:test';
import { db, formSubmission, projectTeam } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createProject,
  createTeam,
  gqlData,
  makePrivate,
  statesByType,
} from '../../../__tests__/helpers/graphql';
import {
  createBoard,
  formLinks,
  instance,
  ok,
  portal,
  visitor,
  type Json,
} from '../../../portal/__tests__/helpers';

// The public form routes (/portal/forms/*, /portal/boards/:slug/forms*): a signed-out
// submission on the link waits for its email to be confirmed; a signed-in visitor's is
// created at once; on a board, only signed-in visitors submit.

const CREATE = `mutation ($input: TemplateCreateInput!) {
  templateCreate(input: $input) { template { id } } }`;
const ISSUE = `query ($id: String!) { issue(id: $id) {
  title project { id } externalUserCreator { name email }
  needs { nodes { body attachment { subtitle } } } } }`;
const ISSUES = `query { issues { nodes { id identifier title } } }`;

const FIELDS = [
  { id: 'title', type: 'shortText', label: 'Summary', required: true, role: 'title' },
  { id: 'details', type: 'longText', label: 'Details', required: false, role: 'quote' },
];
const ANSWERS = { title: 'Export is broken', details: 'The CSV is empty.' };

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  await createTeam(owner, { key: 'OPS', name: 'Operations' });
  const template = (
    await gqlData(owner, CREATE, {
      input: {
        name: 'Bug report',
        type: 'issue',
        teamId: eng.team.id,
        templateData: { stateId: statesByType(eng).unstarted, formFields: FIELDS },
      },
    })
  ).templateCreate.template as { id: string };
  return { owner, eng, template };
}

async function settings(owner: TestUser, templateId: string, extra: Json = {}) {
  await ok(
    await instance('forms/settings', owner, {
      templateId,
      slug: 'bugs',
      linkEnabled: true,
      ...extra,
    }),
  );
}

async function issues(owner: TestUser) {
  return (await gqlData(owner, ISSUES)).issues.nodes as {
    id: string;
    identifier: string;
    title: string;
  }[];
}

const submit = (body: Json, cookie?: string) => portal('forms/bugs', { body, cookie });

// The confirmation link mailed (here: logged) for `email`, after the response.
async function confirmToken(email: string): Promise<string> {
  let url = formLinks.get(email);
  for (let i = 0; !url && i < 100; i++) {
    await Bun.sleep(10);
    url = formLinks.get(email);
  }
  if (!url) throw new Error(`no confirmation link for ${email}`);
  formLinks.delete(email);
  return new URL(url).searchParams.get('token')!;
}

const pendingRows = (email: string) =>
  db.select().from(formSubmission).where(eq(formSubmission.email, email));

beforeEach(async () => {
  await resetDb();
  formLinks.clear();
});

describe('a form on its link', () => {
  it('shows the form while the link is on, without option mappings', async () => {
    const { owner, template } = await setup();
    await settings(owner, template.id, { intro: 'Tell us what broke.' });
    const body = await ok(await portal('forms/bugs'));
    expect(body.name).toBe('Bug report');
    expect(body.intro).toBe('Tell us what broke.');
    expect(body.fields.map((f: Json) => f.id)).toEqual(['title', 'details']);
    expect(body.visitor).toBeNull();
    await settings(owner, template.id, { linkEnabled: false });
    expect((await portal('forms/bugs')).status).toBe(404);
    expect((await portal('forms/nope')).status).toBe(404);
  });

  it('keeps a signed-out submission pending until the email is confirmed', async () => {
    const { owner, template } = await setup();
    await settings(owner, template.id);
    const email = 'jo@example.com';
    const res = await submit({ answers: ANSWERS, email: 'Jo@Example.com', name: 'Jo' });
    expect(await ok(res)).toEqual({ status: 'pending' });
    expect(await issues(owner)).toHaveLength(0);

    const token = await confirmToken(email);
    expect((await ok(await portal(`forms/confirm-info?token=${token}`))).formName).toBe(
      'Bug report',
    );
    const confirmed = await portal('forms/confirm', { body: { token } });
    const body = await ok(confirmed);
    expect(body.identifier).toBe('ENG-1');
    expect(body.boards).toEqual([]);
    const cookie = confirmed.headers.getSetCookie().find((c) => c.startsWith('portal_session='));
    expect(cookie).toBeDefined();
    // The confirmation signed the person in to the portal.
    const me = await ok(await portal('me', { cookie: cookie!.split(';')[0] }));
    expect(me.displayName).toBe('Jo');

    const [created] = await issues(owner);
    const issue = (await gqlData(owner, ISSUE, { id: created!.id })).issue;
    expect(issue.title).toBe('Export is broken');
    expect(issue.externalUserCreator).toEqual({ name: 'Jo', email });
    expect(issue.needs.nodes).toEqual([
      { body: 'The CSV is empty.', attachment: { subtitle: 'Form: Bug report' } },
    ]);
  });

  it('reuses a known requester and works once', async () => {
    const { owner, template } = await setup();
    await settings(owner, template.id);
    const known = await ok(
      await instance('requesters/create', owner, { name: 'Kim Lee', email: 'kim@example.com' }),
    );
    await ok(await submit({ answers: ANSWERS, email: 'KIM@example.com', name: 'Someone' }));
    const token = await confirmToken('kim@example.com');
    await ok(await portal('forms/confirm', { body: { token } }));
    expect((await portal('forms/confirm', { body: { token } })).status).toBe(400);
    expect((await portal(`forms/confirm-info?token=${token}`)).status).toBe(400);
    const [created] = await issues(owner);
    expect(await issues(owner)).toHaveLength(1);
    const issue = (await gqlData(owner, ISSUE, { id: created!.id })).issue;
    expect(issue.externalUserCreator.name).toBe(known.requester.name);
  });

  it('refuses an expired link', async () => {
    const { owner, template } = await setup();
    await settings(owner, template.id);
    await ok(await submit({ answers: ANSWERS, email: 'ex@example.com', name: 'Ex' }));
    const token = await confirmToken('ex@example.com');
    await db
      .update(formSubmission)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(formSubmission.email, 'ex@example.com'));
    expect((await portal('forms/confirm', { body: { token } })).status).toBe(400);
    expect(await issues(owner)).toHaveLength(0);
  });

  it('refuses a confirmation once the form is gone or its team private', async () => {
    const { owner, template } = await setup();
    await settings(owner, template.id);
    await ok(await submit({ answers: ANSWERS, email: 'a@example.com', name: 'A' }));
    await ok(await submit({ answers: ANSWERS, email: 'b@example.com', name: 'B' }));
    const tokenA = await confirmToken('a@example.com');
    const tokenB = await confirmToken('b@example.com');

    await makePrivate(owner, 'ENG');
    expect((await portal('forms/confirm', { body: { token: tokenA } })).status).toBe(400);
    expect(await issues(owner)).toHaveLength(0);
    const requesters = await ok(await instance('requesters?q=example.com', owner));
    expect(requesters.requesters).toHaveLength(0);

    await ok(await instance('forms/delete', owner, { templateId: template.id }));
    expect(await pendingRows('b@example.com')).toHaveLength(0);
    expect((await portal('forms/confirm', { body: { token: tokenB } })).status).toBe(400);
  });

  it('refuses a confirmation for a requester blocked after submitting', async () => {
    const { owner, template } = await setup();
    await settings(owner, template.id);
    const known = await ok(
      await instance('requesters/create', owner, { name: 'Bo', email: 'bo@example.com' }),
    );
    await ok(await submit({ answers: ANSWERS, email: 'bo@example.com', name: 'Bo' }));
    const token = await confirmToken('bo@example.com');
    await ok(
      await instance('portal/block', owner, { requesterId: known.requester.id, blocked: true }),
    );
    expect((await portal('forms/confirm', { body: { token } })).status).toBe(400);
    expect(await issues(owner)).toHaveLength(0);
  });

  it('answers the same for a blocked or rate-limited address, without mail', async () => {
    const { owner, template } = await setup();
    await settings(owner, template.id);
    const blocked = await ok(
      await instance('requesters/create', owner, { name: 'Bad', email: 'bad@example.com' }),
    );
    await ok(
      await instance('portal/block', owner, { requesterId: blocked.requester.id, blocked: true }),
    );
    expect(
      await ok(await submit({ answers: ANSWERS, email: 'bad@example.com', name: 'X' })),
    ).toEqual({ status: 'pending' });
    await Bun.sleep(50);
    expect(formLinks.has('bad@example.com')).toBe(false);
    expect(await pendingRows('bad@example.com')).toHaveLength(0);

    // Confirmation mails count towards the address's link limit (5 an hour).
    const email = 'busy@example.com';
    for (let i = 0; i < 5; i++) await ok(await submit({ answers: ANSWERS, email, name: 'Busy' }));
    expect(await pendingRows(email)).toHaveLength(5);
    expect(await ok(await submit({ answers: ANSWERS, email, name: 'Busy' }))).toEqual({
      status: 'pending',
    });
    expect(await pendingRows(email)).toHaveLength(5);
  });

  it('checks the answers, the email and the name before anything is stored', async () => {
    const { owner, template } = await setup();
    await settings(owner, template.id);
    expect((await submit({ answers: {}, email: 'c@example.com', name: 'C' })).status).toBe(400);
    expect((await submit({ answers: ANSWERS, email: 'nope', name: 'C' })).status).toBe(400);
    expect((await submit({ answers: ANSWERS, email: 'c@example.com' })).status).toBe(400);
    expect(await pendingRows('c@example.com')).toHaveLength(0);
  });

  it('creates the issue at once for a signed-in visitor', async () => {
    const { owner, eng, template } = await setup();
    await createBoard(owner, {
      name: 'Feedback',
      slug: 'feedback',
      teamId: eng.team.id,
      access: 'public',
    });
    await settings(owner, template.id);
    const v = await visitor('feedback', 'Vi');
    const body = await ok(await submit({ answers: ANSWERS }, v.cookie));
    expect(body.status).toBe('created');
    expect(body.identifier).toBe('ENG-1');
    expect(await issues(owner)).toHaveLength(1);
  });

  it('needs a trusted Origin to submit', async () => {
    const { owner, template } = await setup();
    await settings(owner, template.id);
    const { app } = await import('../../../app');
    const res = await app.handle(
      new Request('http://localhost/portal/forms/bugs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ answers: ANSWERS, email: 'o@example.com', name: 'O' }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe('forms on a board', () => {
  async function boardSetup() {
    const base = await setup();
    const board = await createBoard(base.owner, {
      name: 'Feedback',
      slug: 'feedback',
      teamId: base.eng.team.id,
      access: 'public',
    });
    await settings(base.owner, base.template.id, { linkEnabled: false, boardIds: [board.id] });
    return { ...base, board };
  }

  it('lists the forms placed on the board', async () => {
    const { board } = await boardSetup();
    const body = await ok(await portal(`boards/${board.slug}/forms`));
    expect(body.forms.map((f: Json) => f.slug)).toEqual(['bugs']);
    expect(body.forms[0].fields).toHaveLength(2);
  });

  it('takes submissions from signed-in visitors only, recorded on the board', async () => {
    const { owner, board } = await boardSetup();
    const path = `boards/${board.slug}/forms/bugs`;
    expect((await portal(path, { body: { answers: ANSWERS } })).status).toBe(401);
    const v = await visitor(board.slug, 'Vi');
    const body = await ok(await portal(path, { body: { answers: ANSWERS }, cookie: v.cookie }));
    expect(body.identifier).toBe('ENG-1');
    // A team board shows its team's issues, so the new issue is listed.
    const listed = await ok(await portal(`boards/${board.slug}/issues`, { cookie: v.cookie }));
    expect(listed.issues.map((i: Json) => i.identifier)).toContain('ENG-1');
    expect(await issues(owner)).toHaveLength(1);
  });

  it('refuses a form not placed on the board', async () => {
    const { owner, eng, template } = await setup();
    const board = await createBoard(owner, {
      name: 'Other',
      slug: 'other',
      teamId: eng.team.id,
      access: 'public',
    });
    await settings(owner, template.id);
    const v = await visitor(board.slug, 'Vi');
    const res = await portal(`boards/${board.slug}/forms/bugs`, {
      body: { answers: ANSWERS },
      cookie: v.cookie,
    });
    expect(res.status).toBe(404);
    expect((await ok(await portal(`boards/${board.slug}/forms`))).forms).toEqual([]);
  });

  it('on a project board, sets the project and hides the form once the project drops the team', async () => {
    const { owner, eng, template } = await setup();
    const project = await createProject(owner, { name: 'Launch', teamIds: ['ENG', 'OPS'] });
    const board = await createBoard(owner, {
      name: 'Launch',
      slug: 'launch',
      projectId: project.id,
      access: 'public',
    });
    await settings(owner, template.id, { boardIds: [board.id] });
    const v = await visitor(board.slug, 'Vi');
    const path = `boards/${board.slug}/forms/bugs`;
    const body = await ok(await portal(path, { body: { answers: ANSWERS }, cookie: v.cookie }));
    const [created] = await issues(owner);
    expect(body.identifier).toBe(created!.identifier);
    const issue = (await gqlData(owner, ISSUE, { id: created!.id })).issue;
    expect(issue.project).toEqual({ id: project.id });

    await db
      .delete(projectTeam)
      .where(and(eq(projectTeam.projectId, project.id), eq(projectTeam.teamId, eng.team.id)));
    expect((await ok(await portal(`boards/${board.slug}/forms`))).forms).toEqual([]);
    expect((await portal(path, { body: { answers: ANSWERS }, cookie: v.cookie })).status).toBe(404);
  });

  it('is hidden on a restricted board the visitor cannot read', async () => {
    const { owner, board } = await boardSetup();
    await ok(
      await instance('portal/boards/update', owner, {
        id: board.id,
        access: 'restricted',
        allowedDomains: ['acme.com'],
      }),
    );
    expect((await portal(`boards/${board.slug}/forms`)).status).toBe(404);
    const allowed = await visitor(board.slug, 'Al', 'al@acme.com');
    const body = await ok(await portal(`boards/${board.slug}/forms`, { cookie: allowed.cookie }));
    expect(body.forms.map((f: Json) => f.slug)).toEqual(['bugs']);
  });
});
