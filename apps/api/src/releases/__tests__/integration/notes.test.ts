import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createLabel,
  createTeam,
  gqlData,
  statesByType,
  type TeamView,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { authGet } from '../../../__tests__/helpers/oauth';

// Linear's ReleaseNote (releases/notes.ts) and the "Fill from issues" draft.

const NOTE_FIELDS = `id slugId title url releaseCount
  documentContent { content }
  pipeline { id }
  releases { id }
  firstRelease { id }
  lastRelease { id }`;

async function errorCode(as: TestUser, query: string, variables?: Record<string, unknown>) {
  const res = await gql({ cookie: as.cookie }, query, variables);
  return res.body.errors?.[0]?.extensions?.code;
}

async function pipelineFor(
  owner: TestUser,
  team: TeamView,
  input: Record<string, unknown> = {},
): Promise<{ id: string; stages: Record<string, string> }> {
  const data = await gqlData(
    owner,
    `mutation($input: ReleasePipelineCreateInput!) {
      releasePipelineCreate(input: $input) {
        releasePipeline { id stages { nodes { id name } } }
      }
    }`,
    { input: { name: 'Production', type: 'scheduled', teamIds: [team.team.id], ...input } },
  );
  const p = data.releasePipelineCreate.releasePipeline;
  const stages: Record<string, string> = {};
  for (const s of p.stages.nodes) stages[s.name] = s.id;
  return { id: p.id, stages };
}

async function createRelease(as: TestUser, input: Record<string, unknown>) {
  const data = await gqlData(
    as,
    `mutation($input: ReleaseCreateInput!) { releaseCreate(input: $input) { release { id name } } }`,
    { input },
  );
  return data.releaseCreate.release as { id: string; name: string };
}

async function link(as: TestUser, issueId: string, releaseId: string) {
  await gqlData(
    as,
    `mutation($input: IssueToReleaseCreateInput!) {
      issueToReleaseCreate(input: $input) { success }
    }`,
    { input: { issueId, releaseId } },
  );
}

async function complete(as: TestUser, releaseId: string, stageId: string) {
  await gqlData(
    as,
    `mutation($id: String!, $input: ReleaseUpdateInput!) {
      releaseUpdate(id: $id, input: $input) { success }
    }`,
    { id: releaseId, input: { stageId } },
  );
}

async function notesOf(as: TestUser, releaseId: string) {
  const data = await gqlData(
    as,
    `query($id: String!) { release(id: $id) { releaseNotes { ${NOTE_FIELDS} } } }`,
    { id: releaseId },
  );
  return data.release.releaseNotes as {
    id: string;
    title: string | null;
    url: string;
    releaseCount: number;
    documentContent: { content: string };
    releases: { id: string }[];
    firstRelease: { id: string };
    lastRelease: { id: string };
  }[];
}

describe('release notes', () => {
  beforeEach(resetDb);

  // Issues in v1: a completed feature, a completed bug fix, a completed unlabeled one and
  // an unfinished one.
  async function labeledRelease() {
    const owner = await signUpTestUser();
    const team = await createTeam(owner, { key: 'ENG' });
    const states = statesByType(team);
    const pipeline = await pipelineFor(owner, team);
    const feature = await createLabel(owner, { name: 'Feature', teamId: 'ENG' });
    const bug = await createLabel(owner, { name: 'Bug', teamId: 'ENG' });
    const v1 = await createRelease(owner, { name: 'v1', pipelineId: pipeline.id });
    const a = await createIssue(owner, {
      teamId: 'ENG',
      title: 'Dark mode',
      stateId: states.completed,
      labelIds: [feature.id],
    });
    const b = await createIssue(owner, {
      teamId: 'ENG',
      title: 'Crash on save',
      stateId: states.completed,
      labelIds: [bug.id],
    });
    const c = await createIssue(owner, {
      teamId: 'ENG',
      title: 'Faster search',
      stateId: states.completed,
    });
    const d = await createIssue(owner, { teamId: 'ENG', title: 'Not done yet' });
    for (const i of [a, b, c, d]) await link(owner, i.id, v1.id);
    return { owner, team, pipeline, v1, issues: { a, b, c, d } };
  }

  it('drafts a note from the completed issues, grouped by label', async () => {
    const { owner, v1, issues } = await labeledRelease();
    const res = await authGet(`/instance/releases/note-draft?releaseId=${v1.id}`, owner.cookie);
    expect(res.status).toBe(200);
    const draft = (await res.json()) as { title: string; content: string };
    expect(draft.title).toBe('v1');
    expect(draft.content).toBe(
      [
        '## Features',
        '',
        `- Dark mode (${issues.a.identifier})`,
        '',
        '## Bug fixes',
        '',
        `- Crash on save (${issues.b.identifier})`,
        '',
        '## Other',
        '',
        `- Faster search (${issues.c.identifier})`,
        '',
      ].join('\n'),
    );
    expect(draft.content).not.toContain('Not done yet');
  });

  it('refuses the draft to someone who cannot read the release', async () => {
    const owner = await signUpTestUser();
    const outsider = await signUpTestUser();
    const team = await createTeam(owner, { key: 'SEC', private: true });
    const pipeline = await pipelineFor(owner, team);
    const v1 = await createRelease(owner, { name: 'v1', pipelineId: pipeline.id });
    const res = await authGet(`/instance/releases/note-draft?releaseId=${v1.id}`, outsider.cookie);
    expect(res.status).toBe(404);
    expect((await authGet(`/instance/releases/note-draft?releaseId=${v1.id}`, null)).status).toBe(
      401,
    );
  });

  it('creates, updates and deletes a note for a release', async () => {
    const { owner, pipeline, v1 } = await labeledRelease();
    const created = await gqlData(
      owner,
      `mutation($input: ReleaseNoteCreateInput!) {
        releaseNoteCreate(input: $input) { success releaseNote { ${NOTE_FIELDS} } }
      }`,
      { input: { pipelineId: pipeline.id, releaseIds: [v1.id], content: '# Hello' } },
    );
    const note = created.releaseNoteCreate.releaseNote;
    expect(note.documentContent.content).toBe('# Hello');
    expect(note.title).toBeNull();
    expect(note.releaseCount).toBe(1);
    expect(note.pipeline.id).toBe(pipeline.id);
    expect(note.firstRelease.id).toBe(v1.id);
    expect(note.lastRelease.id).toBe(v1.id);
    expect(note.url).toContain('/releases/');

    const updated = await gqlData(
      owner,
      `mutation($id: String!, $input: ReleaseNoteUpdateInput!) {
        releaseNoteUpdate(id: $id, input: $input) { releaseNote { title documentContent { content } } }
      }`,
      { id: note.id, input: { title: 'Spring release', content: 'Body' } },
    );
    expect(updated.releaseNoteUpdate.releaseNote).toEqual({
      title: 'Spring release',
      documentContent: { content: 'Body' },
    });
    expect((await notesOf(owner, v1.id)).map((n) => n.id)).toEqual([note.id]);
    const latest = await gqlData(
      owner,
      `query($id: String!) { releasePipeline(id: $id) { latestReleaseNote { id } } }`,
      { id: pipeline.id },
    );
    expect(latest.releasePipeline.latestReleaseNote.id).toBe(note.id);

    const deleted = await gqlData(
      owner,
      `mutation($id: String!) { releaseNoteDelete(id: $id) { success entityId } }`,
      { id: note.id },
    );
    expect(deleted.releaseNoteDelete).toEqual({ success: true, entityId: note.id });
    expect(await notesOf(owner, v1.id)).toEqual([]);
  });

  it('covers several releases of a continuous pipeline, first and last by completion', async () => {
    const owner = await signUpTestUser();
    const team = await createTeam(owner, { key: 'ENG' });
    const pipeline = await pipelineFor(owner, team, { type: 'continuous' });
    const r1 = await createRelease(owner, { name: 'a1', pipelineId: pipeline.id });
    const r2 = await createRelease(owner, { name: 'a2', pipelineId: pipeline.id });
    const data = await gqlData(
      owner,
      `mutation($input: ReleaseNoteCreateInput!) {
        releaseNoteCreate(input: $input) { releaseNote { releaseCount firstRelease { id } lastRelease { id } } }
      }`,
      { input: { pipelineId: pipeline.id, releaseIds: [r2.id, r1.id], content: 'x' } },
    );
    expect(data.releaseNoteCreate.releaseNote).toEqual({
      releaseCount: 2,
      firstRelease: { id: r1.id },
      lastRelease: { id: r2.id },
    });
  });

  it('refuses releases of another pipeline, none at all, and two on a scheduled pipeline', async () => {
    const { owner, team, pipeline, v1 } = await labeledRelease();
    const other = await pipelineFor(owner, team, { name: 'Staging' });
    const elsewhere = await createRelease(owner, { name: 's1', pipelineId: other.id });
    const v2 = await createRelease(owner, {
      name: 'v2',
      pipelineId: pipeline.id,
      stageId: pipeline.stages.Planned,
    });
    const create = (input: Record<string, unknown>) =>
      errorCode(
        owner,
        `mutation($input: ReleaseNoteCreateInput!) { releaseNoteCreate(input: $input) { success } }`,
        { input: { pipelineId: pipeline.id, content: 'x', ...input } },
      );
    expect(await create({ releaseIds: [elsewhere.id] })).toBe('INVALID_INPUT');
    expect(await create({ releaseIds: [] })).toBe('INVALID_INPUT');
    expect(await create({ releaseIds: [v1.id, v2.id] })).toBe('INVALID_INPUT');
  });

  it('creates the draft once when a release completes in a pipeline that asks for it', async () => {
    const owner = await signUpTestUser();
    const team = await createTeam(owner, { key: 'ENG' });
    const states = statesByType(team);
    const pipeline = await pipelineFor(owner, team, { autoGenerateReleaseNotesOnCompletion: true });
    const v1 = await createRelease(owner, { name: 'v1', pipelineId: pipeline.id });
    const done = await createIssue(owner, {
      teamId: 'ENG',
      title: 'Shipped thing',
      stateId: states.completed,
    });
    await link(owner, done.id, v1.id);
    await complete(owner, v1.id, pipeline.stages.Completed);
    const notes = await notesOf(owner, v1.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.documentContent.content).toContain(`- Shipped thing (${done.identifier})`);

    // Reopened and completed again: still one note.
    await complete(owner, v1.id, pipeline.stages['In progress']!);
    await complete(owner, v1.id, pipeline.stages.Completed);
    expect(await notesOf(owner, v1.id)).toHaveLength(1);
  });

  it('creates no draft when the pipeline does not ask for one', async () => {
    const { owner, pipeline, v1 } = await labeledRelease();
    await complete(owner, v1.id, pipeline.stages.Completed);
    expect(await notesOf(owner, v1.id)).toEqual([]);
  });

  it('hides notes of a private team pipeline from people outside it', async () => {
    const owner = await signUpTestUser();
    const outsider = await signUpTestUser();
    const team = await createTeam(owner, { key: 'SEC', private: true });
    const pipeline = await pipelineFor(owner, team);
    const v1 = await createRelease(owner, { name: 'v1', pipelineId: pipeline.id });
    const data = await gqlData(
      owner,
      `mutation($input: ReleaseNoteCreateInput!) { releaseNoteCreate(input: $input) { releaseNote { id } } }`,
      { input: { pipelineId: pipeline.id, releaseIds: [v1.id], content: 'secret' } },
    );
    const id = data.releaseNoteCreate.releaseNote.id;
    expect(
      await errorCode(outsider, `query($id: String!) { releaseNote(id: $id) { id } }`, { id }),
    ).toBe('ENTITY_NOT_FOUND');
    expect(
      (await gqlData(outsider, `{ releaseNotes { nodes { id } } }`)).releaseNotes.nodes,
    ).toEqual([]);
    expect(
      await errorCode(
        outsider,
        `mutation($id: String!, $input: ReleaseNoteUpdateInput!) {
          releaseNoteUpdate(id: $id, input: $input) { success }
        }`,
        { id, input: { content: 'x' } },
      ),
    ).toBe('ENTITY_NOT_FOUND');
  });

  it('lists notes filtered by pipeline and release', async () => {
    const { owner, team, pipeline, v1 } = await labeledRelease();
    const other = await pipelineFor(owner, team, { name: 'Staging' });
    const s1 = await createRelease(owner, { name: 's1', pipelineId: other.id });
    const make = async (pipelineId: string, releaseId: string) =>
      (
        await gqlData(
          owner,
          `mutation($input: ReleaseNoteCreateInput!) { releaseNoteCreate(input: $input) { releaseNote { id } } }`,
          { input: { pipelineId, releaseIds: [releaseId], content: 'x' } },
        )
      ).releaseNoteCreate.releaseNote.id as string;
    const n1 = await make(pipeline.id, v1.id);
    const n2 = await make(other.id, s1.id);
    const byPipeline = await gqlData(
      owner,
      `query($f: ReleaseNoteFilter) { releaseNotes(filter: $f) { nodes { id } } }`,
      { f: { pipeline: { id: { eq: other.id } } } },
    );
    expect(byPipeline.releaseNotes.nodes).toEqual([{ id: n2 }]);
    const byRelease = await gqlData(
      owner,
      `query($f: ReleaseNoteFilter) { releaseNotes(filter: $f) { nodes { id } } }`,
      { f: { release: { id: { eq: v1.id } } } },
    );
    expect(byRelease.releaseNotes.nodes).toEqual([{ id: n1 }]);
  });
});
