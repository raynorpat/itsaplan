import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';

// Documents over the Linear API: CRUD, the trash, archived parents, visibility,
// filters, unsupported input and the Document webhook.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;
const errorMessage = (res: { body: { errors?: { message?: string }[] } }) =>
  res.body.errors?.[0]?.message ?? '';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
  const mkt = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const ops = (await asOwner.teams({ teamKey: 'OPS' }).get()).data!;
  const project = (await asOwner.projects.post({ teamIds: [mkt.team.id], name: 'Site' })).data!;
  const stateId = ops.states.find((s) => s.stateType === 'unstarted')!.id;
  const issue = (await asOwner.teams({ teamKey: 'OPS' }).issues.post({ stateId, title: 'Bug' }))
    .data!;
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, asOwner, client, project, issue, mkt: mkt.team.id, ops: ops.team.id };
}

const titles = async (cookie: string, query: string) => {
  const res = await gql({ cookie }, query);
  return JSON.stringify(res.body.data);
};

describe('graphql documents', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates, reads by id and slug, updates and lists', async () => {
    const { owner, client, project, issue } = await setup();
    const doc = (await (
      await client.createDocument({ title: 'Spec', content: '# Hi', projectId: project.id })
    ).document)!;
    expect(doc).toMatchObject({ title: 'Spec', content: '# Hi' });
    expect(doc.documentContentId).toBe(doc.id);
    expect((await client.document(doc.slugId)).id).toBe(doc.id);
    const renamed = (await (await client.updateDocument(doc.id, { title: 'Spec v2' })).document)!;
    expect(renamed.title).toBe('Spec v2');
    expect((await renamed.updatedBy)?.id).toBe(owner.userId);
    expect((await (await client.project(project.id)).documents()).nodes.map((d) => d.id)).toEqual([
      doc.id,
    ]);
    const onIssue = (await (
      await client.createDocument({ title: 'Notes', issueId: issue.id })
    ).document)!;
    expect((await (await client.issue(issue.id)).documents()).nodes.map((d) => d.id)).toEqual([
      onIssue.id,
    ]);
    expect((await client.documents()).nodes).toHaveLength(2);
    expect((await (await client.document(onIssue.id)).issue)?.id).toBe(issue.id);
  });

  it('deletes to the trash and unarchives', async () => {
    const { client, project } = await setup();
    const doc = (await (
      await client.createDocument({ title: 'Spec', projectId: project.id })
    ).document)!;
    const deleted = await client.deleteDocument(doc.id);
    expect((await deleted.entity)?.trashed).toBe(true);
    expect((await client.documents()).nodes).toHaveLength(0);
    expect((await client.documents({ includeArchived: true })).nodes).toHaveLength(1);
    expect((await client.document(doc.id)).archivedAt).toBeTruthy();
    await client.unarchiveDocument(doc.id);
    expect((await client.documents()).nodes).toHaveLength(1);
  });

  it('hides documents of archived projects unless includeArchived', async () => {
    const { asOwner, client, project } = await setup();
    await client.createDocument({ title: 'Spec', projectId: project.id });
    await asOwner.projects({ projectId: project.id }).archive.post();
    expect((await client.documents()).nodes).toHaveLength(0);
    expect((await client.documents({ includeArchived: true })).nodes).toHaveLength(1);
  });

  it('hides documents from users who cannot see the parent', async () => {
    const { client, project } = await setup();
    const doc = (await (
      await client.createDocument({ title: 'Spec', projectId: project.id })
    ).document)!;
    const outsider = await signUpTestUser();
    const res = await gql({ cookie: outsider.cookie }, `{ document(id: "${doc.id}") { id } }`);
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    const list = await gql({ cookie: outsider.cookie }, '{ documents { nodes { id } } }');
    expect(list.body.data).toEqual({ documents: { nodes: [] } });
  });

  it('filters documents', async () => {
    const { owner, client, project, issue, mkt, ops } = await setup();
    await client.createDocument({ title: 'Project spec', projectId: project.id });
    await client.createDocument({ title: 'Issue notes', issueId: issue.id });
    const q = (filter: string) =>
      titles(owner.cookie, `{ documents(filter: ${filter}) { nodes { title } } }`);
    expect(await q('{ title: { contains: "spec" } }')).toContain('Project spec');
    expect(await q('{ title: { contains: "spec" } }')).not.toContain('Issue notes');
    expect(await q(`{ project: { id: { eq: "${project.id}" } } }`)).not.toContain('Issue notes');
    expect(await q(`{ issue: { id: { eq: "${issue.id}" } } }`)).not.toContain('Project spec');
    expect(await q(`{ team: { id: { eq: "${mkt}" } } }`)).not.toContain('Issue notes');
    expect(await q(`{ team: { id: { eq: "${ops}" } } }`)).toContain('Issue notes');
    expect(await q(`{ creator: { id: { eq: "${owner.userId}" } } }`)).toContain('Issue notes');
  });

  it('rejects unsupported input and two parents', async () => {
    const { owner, client, project, issue } = await setup();
    const doc = (await (
      await client.createDocument({ title: 'Spec', projectId: project.id })
    ).document)!;
    const release = await gql(
      { cookie: owner.cookie },
      `mutation { documentCreate(input: { title: "X", projectId: "${project.id}", releaseId: "${project.id}" }) { success } }`,
    );
    expect(errorCode(release)).toBe('INVALID_INPUT');
    expect(errorMessage(release)).toContain('releaseId');
    const trashed = await gql(
      { cookie: owner.cookie },
      `mutation { documentUpdate(id: "${doc.id}", input: { trashed: true }) { success } }`,
    );
    expect(errorCode(trashed)).toBe('INVALID_INPUT');
    expect(errorMessage(trashed)).toContain('trashed');
    const both = await gql(
      { cookie: owner.cookie },
      `mutation { documentCreate(input: { title: "X", projectId: "${project.id}", issueId: "${issue.id}" }) { success } }`,
    );
    expect(errorCode(both)).toBe('INVALID_INPUT');
  });

  it('sends a Document webhook on documentCreate', async () => {
    const { asOwner, client, project } = await setup();
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Document'] })
    ).data!;
    await client.createDocument({ title: 'Spec', projectId: project.id });
    const items = (await asOwner.webhooks({ webhookId: hook.id }).deliveries.get()).data!.items;
    expect(items.map((d) => (d.payload as { type: string; action: string }).action)).toEqual([
      'create',
    ]);
  });
});
