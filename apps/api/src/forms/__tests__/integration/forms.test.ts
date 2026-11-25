import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createLabel,
  createProject,
  createState,
  createTeam,
  createWebhook,
  gqlData,
  makePrivate,
  signUpAs,
  statesByType,
  type As,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';
import {
  createBoard,
  instance,
  ok,
  portal,
  visitor,
  type Json,
} from '../../../portal/__tests__/helpers';
import { formIssueDescription, getFormBySlug, validateAnswers } from '../../settings';
import { submitForm } from '../../submit';

// Forms: a team issue template with form settings (slug, intro, link, boards), managed
// by owners and admins; a submission's answers become an issue and feedback.

const headers = (as: As) => ('headers' in as ? as.headers : { cookie: as.cookie });
const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

const CREATE = `mutation ($input: TemplateCreateInput!) {
  templateCreate(input: $input) { template { id } } }`;
const UPDATE = `mutation ($id: String!, $input: TemplateUpdateInput!) {
  templateUpdate(id: $id, input: $input) { success } }`;
const DELETE = `mutation ($id: String!) { templateDelete(id: $id) { success } }`;

const ISSUE = `query ($id: String!) { issue(id: $id) {
  title description priority state { id } project { id }
  labels { nodes { id } }
  externalUserCreator { name }
  needs { nodes { body attachment { subtitle externalUserCreator { name } } } } } }`;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const member = await signUpAs('member', { name: 'Mia' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  const ops = await createTeam(owner, { key: 'OPS', name: 'Operations' });
  await addMember(owner, 'ENG', member.userId);
  const states = statesByType(eng);
  const bug = await createLabel(owner, { name: 'bug', teamId: 'ENG' });
  const feature = await createLabel(owner, { name: 'feature', teamId: 'ENG' });
  const fields = [
    { id: 'title', type: 'shortText', label: 'Summary', required: true, role: 'title' },
    { id: 'details', type: 'longText', label: 'What happened?', required: false, role: 'quote' },
    {
      id: 'kind',
      type: 'select',
      label: 'Type',
      required: true,
      options: [
        { id: 'bug', label: 'Bug', labelId: bug.id },
        { id: 'idea', label: 'Idea', labelId: feature.id, priority: 3 },
      ],
    },
    {
      id: 'urgency',
      type: 'select',
      label: 'How urgent?',
      required: false,
      options: [
        { id: 'high', label: 'High', priority: 2 },
        { id: 'low', label: 'Low', priority: 4 },
      ],
    },
    {
      id: 'areas',
      type: 'multiSelect',
      label: 'Areas',
      required: false,
      options: [
        { id: 'web', label: 'Web' },
        { id: 'api', label: 'API' },
      ],
    },
    { id: 'contact', type: 'checkbox', label: 'Can we contact you?', required: false },
  ];
  const template = (
    await gqlData(owner, CREATE, {
      input: {
        name: 'Bug report',
        type: 'issue',
        teamId: eng.team.id,
        templateData: {
          description: 'Sent through the bug report form.',
          stateId: states.unstarted,
          formFields: fields,
        },
      },
    })
  ).templateCreate.template as { id: string };
  return { owner, member, eng, ops, states, bug, feature, template };
}

const saveSettings = (as: TestUser, body: Json) => instance('forms/settings', as, body);

async function makeForm(owner: TestUser, templateId: string, extra: Json = {}) {
  await ok(await saveSettings(owner, { templateId, slug: 'bugs', linkEnabled: true, ...extra }));
  return (await getFormBySlug((extra.slug as string) ?? 'bugs'))!;
}

async function requester(owner: TestUser, name: string, email: string) {
  const body = await ok(await instance('requesters/create', owner, { name, email }));
  return body.requester.id as string;
}

const readIssue = async (as: As, id: string) => (await gqlData(as, ISSUE, { id })).issue as Json;

describe('form settings', () => {
  beforeEach(resetDb);

  it('admins save and list form settings; members cannot', async () => {
    const { owner, member, template, eng } = await setup();
    const res = await saveSettings(owner, {
      templateId: template.id,
      slug: 'bugs',
      intro: 'Tell us what broke',
      linkEnabled: true,
    });
    expect(res.status).toBe(200);
    await ok(await saveSettings(owner, { templateId: template.id, slug: 'bugs', intro: 'New' }));
    const list = (await ok(await instance('forms', owner))).forms as Json[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      templateId: template.id,
      name: 'Bug report',
      teamId: eng.team.id,
      slug: 'bugs',
      intro: 'New',
      linkEnabled: false,
      boardIds: [],
    });
    expect((await saveSettings(member, { templateId: template.id, slug: 'x' })).status).toBe(403);
    expect((await instance('forms', member)).status).toBe(403);
  });

  it('refuses a bad slug, a taken slug, a workspace template and a private team', async () => {
    const { owner, template, ops } = await setup();
    expect((await saveSettings(owner, { templateId: template.id, slug: 'Bad Slug' })).status).toBe(
      400,
    );
    await ok(await saveSettings(owner, { templateId: template.id, slug: 'bugs' }));
    const other = (
      await gqlData(owner, CREATE, {
        input: { name: 'Other', type: 'issue', teamId: ops.team.id, templateData: {} },
      })
    ).templateCreate.template as { id: string };
    expect((await saveSettings(owner, { templateId: other.id, slug: 'bugs' })).status).toBe(409);

    const workspace = (
      await gqlData(owner, CREATE, {
        input: { name: 'Workspace', type: 'issue', templateData: {} },
      })
    ).templateCreate.template as { id: string };
    expect((await saveSettings(owner, { templateId: workspace.id, slug: 'ws' })).status).toBe(400);

    await makePrivate(owner, 'OPS');
    expect((await saveSettings(owner, { templateId: other.id, slug: 'ops' })).status).toBe(400);
  });

  it('places a form only on boards of its team or of a project including it', async () => {
    const { owner, template, eng, ops } = await setup();
    const engBoard = await createBoard(owner, { slug: 'eng', name: 'Eng', teamId: eng.team.id });
    const opsBoard = await createBoard(owner, { slug: 'ops', name: 'Ops', teamId: ops.team.id });
    const project = await createProject(owner, { name: 'Launch', teamIds: ['ENG', 'OPS'] });
    const projectBoard = await createBoard(owner, {
      slug: 'launch',
      name: 'Launch',
      projectId: project.id,
    });
    expect(
      (
        await saveSettings(owner, {
          templateId: template.id,
          slug: 'bugs',
          boardIds: [opsBoard.id],
        })
      ).status,
    ).toBe(400);
    await ok(
      await saveSettings(owner, {
        templateId: template.id,
        slug: 'bugs',
        boardIds: [engBoard.id, projectBoard.id],
      }),
    );
    const form = await getFormBySlug('bugs');
    expect(form!.settings.boardIds.sort()).toEqual([engBoard.id, projectBoard.id].sort());
  });

  it('lets only owners and admins change or delete a form template through GraphQL', async () => {
    const { owner, member, template } = await setup();
    // Before it is a form, the team's member may edit it.
    expect(
      errorCode(await gql(headers(member), UPDATE, { id: template.id, input: { name: 'Bugs' } })),
    ).toBeUndefined();
    await ok(await saveSettings(owner, { templateId: template.id, slug: 'bugs' }));
    expect(
      errorCode(await gql(headers(member), UPDATE, { id: template.id, input: { name: 'X' } })),
    ).toBe('FORBIDDEN');
    expect(errorCode(await gql(headers(member), DELETE, { id: template.id }))).toBe('FORBIDDEN');
    expect(
      errorCode(await gql(headers(owner), UPDATE, { id: template.id, input: { name: 'Y' } })),
    ).toBeUndefined();
  });

  it('deletes a form with its template', async () => {
    const { owner, member, template } = await setup();
    await ok(await saveSettings(owner, { templateId: template.id, slug: 'bugs' }));
    expect((await instance('forms/delete', member, { templateId: template.id })).status).toBe(403);
    await ok(await instance('forms/delete', owner, { templateId: template.id }));
    expect(await getFormBySlug('bugs')).toBeNull();
    const read = await gql(headers(owner), `query ($id: String!) { template(id: $id) { id } }`, {
      id: template.id,
    });
    expect(errorCode(read)).toBe('ENTITY_NOT_FOUND');
  });

  it('hides a form whose team became private', async () => {
    const { owner, template } = await setup();
    await makeForm(owner, template.id);
    expect(await getFormBySlug('bugs')).not.toBeNull();
    await makePrivate(owner, 'ENG');
    expect(await getFormBySlug('bugs')).toBeNull();
  });
});

describe('answers', () => {
  beforeEach(resetDb);

  it('checks the answers against the form', async () => {
    const { owner, template } = await setup();
    const form = await makeForm(owner, template.id);
    const valid = { title: 'Crash', kind: 'bug' };
    expect(validateAnswers(form, valid)).toEqual(valid);
    const bad = (answers: unknown) => () => validateAnswers(form, answers);
    expect(bad({ kind: 'bug' })).toThrow('Summary is required');
    expect(bad({ ...valid, nope: 'x' })).toThrow();
    expect(bad({ ...valid, kind: 'other' })).toThrow();
    expect(bad({ ...valid, areas: 'web' })).toThrow();
    expect(bad({ ...valid, areas: ['web', 'nope'] })).toThrow();
    expect(bad({ ...valid, contact: 'yes' })).toThrow();
    expect(bad({ ...valid, details: 'x'.repeat(10_001) })).toThrow();
    expect(bad('not an object')).toThrow();
    expect(validateAnswers(form, { ...valid, details: 'x'.repeat(10_000) }).details).toHaveLength(
      10_000,
    );
  });

  it('writes the template description, then each answered question in order', async () => {
    const { owner, template } = await setup();
    const form = await makeForm(owner, template.id);
    const description = formIssueDescription(form, {
      title: 'Crash on save',
      details: '# Heading\n\n<script>alert(1)</script> and [a link](https://x.test)',
      kind: 'idea',
      areas: ['web', 'api'],
      contact: false,
    });
    expect(description).toBe(
      [
        'Sent through the bug report form.',
        '',
        '**Summary**',
        '',
        'Crash on save',
        '',
        '**What happened?**',
        '',
        '# Heading\n\n<script>alert(1)</script> and [a link](https://x.test)',
        '',
        '**Type**',
        '',
        'Idea',
        '',
        '**Areas**',
        '',
        'Web, API',
        '',
        '**Can we contact you?**',
        '',
        'No',
      ].join('\n'),
    );
  });
});

describe('form submissions', () => {
  beforeEach(resetDb);

  it('creates the issue with labels, priority, title and feedback from the answers', async () => {
    const { owner, template, states, bug, feature } = await setup();
    const form = await makeForm(owner, template.id);
    const hook = await createWebhook(owner, {
      url: 'https://example.com/hook',
      resourceTypes: ['Issue'],
      teamId: 'ENG',
    });
    const jane = await requester(owner, 'Jane Doe', 'jane@example.com');
    const created = await submitForm(
      form,
      { title: 'T'.repeat(300), details: 'It crashes', kind: 'idea', urgency: 'high' },
      jane,
      { boardId: null, projectId: null },
    );
    const read = await readIssue(owner, created.issueId);
    expect(read.title).toBe('T'.repeat(255));
    expect(read.state.id).toBe(states.unstarted);
    expect(read.priority).toBe(2);
    expect(read.labels.nodes.map((l: Json) => l.id)).toEqual([feature.id]);
    expect(read.labels.nodes.map((l: Json) => l.id)).not.toContain(bug.id);
    expect(read.externalUserCreator).toEqual({ name: 'Jane Doe' });
    expect(read.needs.nodes).toEqual([
      {
        body: 'It crashes',
        attachment: { subtitle: 'Form: Bug report', externalUserCreator: { name: 'Jane Doe' } },
      },
    ]);
    const actions = (await webhookDeliveries(hook.id)).data.items.map(
      (d) => `${(d.payload as Json).type}:${(d.payload as Json).action}`,
    );
    expect(actions).toContain('Issue:create');
  });

  it("uses the template's priority without a chosen one, and a default title", async () => {
    const { owner, eng } = await setup();
    const t = (
      await gqlData(owner, CREATE, {
        input: {
          name: 'Feedback',
          type: 'issue',
          teamId: eng.team.id,
          templateData: {
            priority: 4,
            formFields: [{ id: 'note', type: 'longText', label: 'Note', required: false }],
          },
        },
      })
    ).templateCreate.template as { id: string };
    const form = await makeForm(owner, t.id, { slug: 'feedback' });
    const jane = await requester(owner, 'Jane Doe', 'jane@example.com');
    const created = await submitForm(form, {}, jane, { boardId: null, projectId: null });
    const read = await readIssue(owner, created.issueId);
    expect(read.title).toBe('Feedback from Jane Doe');
    expect(read.priority).toBe(4);
    expect(read.needs.nodes[0].body).toBeNull();
  });

  it('skips an option label that was deleted and a state that was archived', async () => {
    const { owner, template, bug, states } = await setup();
    const ready = await createState(owner, { teamId: 'ENG', name: 'Ready', type: 'unstarted' });
    const data = (
      await gqlData(owner, `query ($id: String!) { template(id: $id) { templateData } }`, {
        id: template.id,
      })
    ).template.templateData;
    await gqlData(owner, UPDATE, {
      id: template.id,
      input: { templateData: { ...data, stateId: ready.id } },
    });
    const form = await makeForm(owner, template.id);
    await gqlData(owner, `mutation ($id: String!) { issueLabelDelete(id: $id) { success } }`, {
      id: bug.id,
    });
    await gqlData(owner, `mutation ($id: String!) { workflowStateArchive(id: $id) { success } }`, {
      id: ready.id,
    });
    const fresh = (await getFormBySlug('bugs'))!;
    const jane = await requester(owner, 'Jane', 'jane@example.com');
    const created = await submitForm(fresh, { title: 'Crash', kind: 'bug' }, jane, {
      boardId: null,
      projectId: null,
    });
    const read = await readIssue(owner, created.issueId);
    expect(read.labels.nodes).toEqual([]);
    expect(read.state.id).toBe(states.backlog);
    expect(form.data.stateId).toBe(ready.id);
  });

  it('adds a project board origin and shows the issue under review on that board only', async () => {
    const { owner, template, eng } = await setup();
    const project = await createProject(owner, { name: 'Launch', teamIds: ['ENG'] });
    const launch = await createBoard(owner, {
      slug: 'launch',
      name: 'Launch',
      projectId: project.id,
      labelIds: [(await createLabel(owner, { name: 'public', teamId: 'ENG' })).id],
    });
    await createBoard(owner, {
      slug: 'other',
      name: 'Other',
      teamId: eng.team.id,
      labelIds: [(await createLabel(owner, { name: 'shown', teamId: 'ENG' })).id],
    });
    const form = await makeForm(owner, template.id, { boardIds: [launch.id] });
    const jane = await visitor('launch', 'Jane');
    const joe = await visitor('launch', 'Joe');
    const created = await submitForm(form, { title: 'Crash', kind: 'bug' }, jane.requesterId, {
      boardId: launch.id,
      projectId: project.id,
    });
    expect((await readIssue(owner, created.issueId)).project).toEqual({ id: project.id });
    const list = async (slug: string, cookie: string) =>
      (await ok(await portal(`boards/${slug}/issues`, { cookie }))).issues as Json[];
    expect((await list('launch', jane.cookie)).map((i) => [i.identifier, i.underReview])).toEqual([
      [created.identifier, true],
    ]);
    expect(await list('other', jane.cookie)).toEqual([]);
    expect(await list('launch', joe.cookie)).toEqual([]);
  });
});

describe('portal suggestions and their board', () => {
  beforeEach(resetDb);

  it('shows a suggestion under review only on the board it was made on', async () => {
    const { owner, eng, states } = await setup();
    const filter = await createLabel(owner, { name: 'roadmap', teamId: 'ENG' });
    const suggestions = {
      suggestionsEnabled: true,
      suggestionTeamId: eng.team.id,
      suggestionStateId: states.backlog,
    };
    await createBoard(owner, {
      slug: 'a',
      name: 'A',
      teamId: eng.team.id,
      labelIds: [filter.id],
      ...suggestions,
    });
    await createBoard(owner, {
      slug: 'b',
      name: 'B',
      teamId: eng.team.id,
      labelIds: [filter.id],
      ...suggestions,
    });
    const jane = await visitor('a', 'Jane');
    const made = await ok(
      await portal('boards/a/suggestions', { cookie: jane.cookie, body: { title: 'Dark mode' } }),
    );
    const list = async (slug: string) =>
      (await ok(await portal(`boards/${slug}/issues`, { cookie: jane.cookie }))).issues as Json[];
    expect((await list('a')).map((i) => [i.identifier, i.underReview])).toEqual([
      [made.identifier, true],
    ]);
    expect(await list('b')).toEqual([]);
  });
});
