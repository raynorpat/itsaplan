import { beforeEach, describe, expect, it } from 'bun:test';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createLabel,
  createTeam,
  gqlData,
  makePrivate,
  signUpAs,
  type As,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { signUpTestUser } from '../../../__tests__/helpers/auth';

// Linear's Template, issue templates only: reads through template / templates /
// templateSearch / Team.templates / Organization.templates, the issue template data
// checks, and who may manage team and workspace templates.

const headers = (as: As) => ('headers' in as ? as.headers : { cookie: as.cookie });
const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

const FIELDS = `id name description type templateData hasFormFields sortOrder
  team { id } creator { id } lastUpdatedBy { id }`;

const CREATE = `mutation ($input: TemplateCreateInput!) {
  templateCreate(input: $input) { success template { ${FIELDS} } } }`;
const UPDATE = `mutation ($id: String!, $input: TemplateUpdateInput!) {
  templateUpdate(id: $id, input: $input) { success template { ${FIELDS} } } }`;
const DELETE = `mutation ($id: String!) { templateDelete(id: $id) { success entityId } }`;

const createRaw = (as: As, input: Record<string, unknown>) => gql(headers(as), CREATE, { input });

async function create(as: As, input: Record<string, unknown>) {
  const data = await gqlData(as, CREATE, { input });
  return data.templateCreate.template;
}

const bugFields = (labelId?: string) => [
  { id: 'title', type: 'shortText', label: 'Summary', required: true, role: 'title' },
  { id: 'details', type: 'longText', label: 'What happened?', required: false, role: 'quote' },
  {
    id: 'kind',
    type: 'select',
    label: 'Type',
    required: true,
    options: [
      { id: 'bug', label: 'Bug', ...(labelId ? { labelId } : {}) },
      { id: 'idea', label: 'Idea', priority: 3 },
    ],
  },
  { id: 'ok', type: 'checkbox', label: 'Can we contact you?', required: false },
];

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  const ops = await createTeam(owner, { key: 'OPS', name: 'Operations' });
  const member = await signUpAs('member', { name: 'Mia' });
  await addMember(owner, 'ENG', member.userId);
  const bugLabel = await createLabel(owner, { name: 'bug', teamId: 'ENG' });
  return { owner, eng, ops, member, bugLabel };
}

describe('templates', () => {
  beforeEach(resetDb);

  it('creates a team issue template and reads it back everywhere', async () => {
    const { member, eng, bugLabel } = await setup();
    const stateId = eng.states[0]!.id;
    const created = await create(member, {
      name: 'Bug report',
      description: 'Report a bug',
      type: 'issue',
      teamId: eng.team.id,
      templateData: {
        title: 'Bug: ',
        description: 'Steps to reproduce',
        stateId,
        labelIds: [bugLabel.id],
        priority: 2,
        formFields: bugFields(bugLabel.id),
      },
    });
    expect(created.name).toBe('Bug report');
    expect(created.type).toBe('issue');
    expect(created.hasFormFields).toBe(true);
    expect(created.team.id).toBe(eng.team.id);
    expect(created.creator.id).toBe(member.userId);
    expect(created.lastUpdatedBy.id).toBe(member.userId);
    expect(created.templateData.stateId).toBe(stateId);
    expect(created.templateData.formFields).toHaveLength(4);

    const read = await gqlData(member, `query ($id: String!) { template(id: $id) { ${FIELDS} } }`, {
      id: created.id,
    });
    expect(read.template.templateData).toEqual(created.templateData);

    const lists = await gqlData(
      member,
      `query ($team: String!, $teamId: ID!) {
        templates { id }
        templateSearch(filter: { team: { id: { eq: $teamId } } }) { id }
        team(id: $team) { templates { nodes { id } } }
        organization { templates { nodes { id } } }
      }`,
      { team: eng.team.id, teamId: eng.team.id },
    );
    expect(lists.templates.map((t: { id: string }) => t.id)).toEqual([created.id]);
    expect(lists.templateSearch.map((t: { id: string }) => t.id)).toEqual([created.id]);
    expect(lists.team.templates.nodes.map((t: { id: string }) => t.id)).toEqual([created.id]);
    expect(lists.organization.templates.nodes).toEqual([]);
  });

  it('reads hasFormFields false for a template without form fields', async () => {
    const { member, eng } = await setup();
    const created = await create(member, {
      name: 'Plain',
      type: 'issue',
      teamId: eng.team.id,
      templateData: { title: 'Chore' },
    });
    expect(created.hasFormFields).toBe(false);
  });

  it('refuses other template types', async () => {
    const { member, eng } = await setup();
    const res = await createRaw(member, {
      name: 'Project',
      type: 'project',
      teamId: eng.team.id,
      templateData: {},
    });
    expect(errorCode(res)).toBe('INVALID_INPUT');
  });

  const invalidData: [string, (ids: { stateOfOps: string; opsLabel: string }) => unknown][] = [
    ['an unknown key', () => ({ assignee: 'x' })],
    ['an unknown field type', () => ({ formFields: [{ id: 'a', type: 'date', label: 'When' }] })],
    [
      'duplicate field ids',
      () => ({
        formFields: [
          { id: 'a', type: 'shortText', label: 'A' },
          { id: 'a', type: 'longText', label: 'B' },
        ],
      }),
    ],
    [
      'duplicate option ids',
      () => ({
        formFields: [
          {
            id: 'k',
            type: 'select',
            label: 'Kind',
            options: [
              { id: 'o', label: 'One' },
              { id: 'o', label: 'Two' },
            ],
          },
        ],
      }),
    ],
    [
      'two title fields',
      () => ({
        formFields: [
          { id: 'a', type: 'shortText', label: 'A', role: 'title' },
          { id: 'b', type: 'shortText', label: 'B', role: 'title' },
        ],
      }),
    ],
    [
      'two quote fields',
      () => ({
        formFields: [
          { id: 'a', type: 'longText', label: 'A', role: 'quote' },
          { id: 'b', type: 'longText', label: 'B', role: 'quote' },
        ],
      }),
    ],
    [
      'a title role on a long text field',
      () => ({ formFields: [{ id: 'a', type: 'longText', label: 'A', role: 'title' }] }),
    ],
    [
      'a quote role on a short text field',
      () => ({ formFields: [{ id: 'a', type: 'shortText', label: 'A', role: 'quote' }] }),
    ],
    [
      'a select without options',
      () => ({ formFields: [{ id: 'a', type: 'select', label: 'A', options: [] }] }),
    ],
    ['a state of another team', ({ stateOfOps }) => ({ stateId: stateOfOps })],
    ['a label of another team', ({ opsLabel }) => ({ labelIds: [opsLabel] })],
    [
      'an option label of another team',
      ({ opsLabel }) => ({
        formFields: [
          {
            id: 'k',
            type: 'select',
            label: 'Kind',
            options: [{ id: 'o', label: 'O', labelId: opsLabel }],
          },
        ],
      }),
    ],
    ['a priority of 5', () => ({ priority: 5 })],
    [
      'an option priority of -1',
      () => ({
        formFields: [
          {
            id: 'k',
            type: 'select',
            label: 'Kind',
            options: [{ id: 'o', label: 'O', priority: -1 }],
          },
        ],
      }),
    ],
    [
      '51 fields',
      () => ({
        formFields: Array.from({ length: 51 }, (_, i) => ({
          id: `f${i}`,
          type: 'shortText',
          label: `Field ${i}`,
        })),
      }),
    ],
    [
      '51 options',
      () => ({
        formFields: [
          {
            id: 'k',
            type: 'select',
            label: 'Kind',
            options: Array.from({ length: 51 }, (_, i) => ({ id: `o${i}`, label: `O${i}` })),
          },
        ],
      }),
    ],
  ];

  for (const [name, data] of invalidData)
    it(`refuses template data with ${name}`, async () => {
      const { owner, member, eng, ops } = await setup();
      const opsLabel = await createLabel(owner, { name: 'ops', teamId: 'OPS' });
      const res = await createRaw(member, {
        name: 'Bad',
        type: 'issue',
        teamId: eng.team.id,
        templateData: data({ stateOfOps: ops.states[0]!.id, opsLabel: opsLabel.id }),
      });
      expect(errorCode(res)).toBe('INVALID_INPUT');
    });

  it('accepts exactly 50 fields', async () => {
    const { member, eng } = await setup();
    const created = await create(member, {
      name: 'Long',
      type: 'issue',
      teamId: eng.team.id,
      templateData: {
        formFields: Array.from({ length: 50 }, (_, i) => ({
          id: `f${i}`,
          type: 'shortText',
          label: `Field ${i}`,
        })),
      },
    });
    expect(created.templateData.formFields).toHaveLength(50);
  });

  it('lets only admins manage workspace templates', async () => {
    const { owner, member } = await setup();
    const workspaceLabel = await createLabel(owner, { name: 'feedback' });
    const input = {
      name: 'Workspace request',
      type: 'issue',
      templateData: { labelIds: [workspaceLabel.id] },
    };
    expect(errorCode(await createRaw(member, input))).toBe('FORBIDDEN');
    const admin = await signUpAs('admin', { name: 'Ada' });
    const created = await create(admin, input);
    expect(created.team).toBeNull();
    const read = await gqlData(member, `{ organization { templates { nodes { id } } } }`);
    expect(read.organization.templates.nodes.map((t: { id: string }) => t.id)).toEqual([
      created.id,
    ]);
    const res = await gql(headers(member), UPDATE, { id: created.id, input: { name: 'Mine' } });
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('refuses a state on a workspace template', async () => {
    const { owner, eng } = await setup();
    const res = await createRaw(owner, {
      name: 'Workspace',
      type: 'issue',
      templateData: { stateId: eng.states[0]!.id },
    });
    expect(errorCode(res)).toBe('INVALID_INPUT');
  });

  it("lets a guest read their team's templates but not create one", async () => {
    const { owner, eng } = await setup();
    const created = await create(owner, {
      name: 'Bug report',
      type: 'issue',
      teamId: eng.team.id,
      templateData: { title: 'Bug' },
    });
    const guest = await signUpAs('guest', { name: 'Gus' });
    await addMember(owner, 'ENG', guest.userId);
    const read = await gqlData(guest, `query ($id: String!) { template(id: $id) { id } }`, {
      id: created.id,
    });
    expect(read.template.id).toBe(created.id);
    const res = await createRaw(guest, {
      name: 'Guest',
      type: 'issue',
      teamId: eng.team.id,
      templateData: {},
    });
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('hides a private team template from people outside the team', async () => {
    const { owner, eng } = await setup();
    const created = await create(owner, {
      name: 'Secret',
      type: 'issue',
      teamId: eng.team.id,
      templateData: {},
    });
    await makePrivate(owner, 'ENG');
    const outsider = await signUpAs('member', { name: 'Olu' });
    const res = await gql(headers(outsider), `query ($id: String!) { template(id: $id) { id } }`, {
      id: created.id,
    });
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
  });

  it('updates a template and re-checks its data', async () => {
    const { member, eng } = await setup();
    const created = await create(member, {
      name: 'Bug report',
      type: 'issue',
      teamId: eng.team.id,
      templateData: { title: 'Bug' },
    });
    const updated = await gqlData(member, UPDATE, {
      id: created.id,
      input: { name: 'Bug', templateData: { title: 'Bug', priority: 1 } },
    });
    expect(updated.templateUpdate.template.name).toBe('Bug');
    expect(updated.templateUpdate.template.templateData.priority).toBe(1);
    const bad = await gql(headers(member), UPDATE, {
      id: created.id,
      input: { templateData: { priority: 9 } },
    });
    expect(errorCode(bad)).toBe('INVALID_INPUT');
  });

  it("refuses a member changing another team's template", async () => {
    const { owner, ops } = await setup();
    const created = await create(owner, {
      name: 'Ops',
      type: 'issue',
      teamId: ops.team.id,
      templateData: {},
    });
    const outsider = await signUpAs('member', { name: 'Olu' });
    const res = await gql(headers(outsider), UPDATE, { id: created.id, input: { name: 'X' } });
    // OPS is public, so the member sees it; Linear lets members manage team templates of
    // teams they are in only.
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('deletes a template', async () => {
    const { member, eng } = await setup();
    const created = await create(member, {
      name: 'Bug report',
      type: 'issue',
      teamId: eng.team.id,
      templateData: {},
    });
    const del = await gqlData(member, DELETE, { id: created.id });
    expect(del.templateDelete.entityId).toBe(created.id);
    const res = await gql(headers(member), `query ($id: String!) { template(id: $id) { id } }`, {
      id: created.id,
    });
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
  });
});
