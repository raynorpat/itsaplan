import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { addMember, createTeam, gqlData, signUpAs } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Linear's release pipelines and their stages (releases/pipelines.ts, stages.ts).

const PIPELINE_FIELDS = `id name slugId type isProduction rolloverIssuesOnCompletion
  autoGenerateReleaseNotesOnCompletion includePathPatterns trashed archivedAt url
  teams { nodes { key } }
  stages { nodes { id name type color position frozen } }`;

const CREATE = `mutation($input: ReleasePipelineCreateInput!) {
  releasePipelineCreate(input: $input) { success releasePipeline { ${PIPELINE_FIELDS} } }
}`;

async function errorCode(as: TestUser, query: string, variables?: Record<string, unknown>) {
  const res = await gql({ cookie: as.cookie }, query, variables);
  return res.body.errors?.[0]?.extensions?.code;
}

async function createPipeline(as: TestUser, input: Record<string, unknown>) {
  const data = await gqlData(as, CREATE, { input });
  return data.releasePipelineCreate.releasePipeline;
}

describe('release pipelines', () => {
  beforeEach(resetDb);

  it('creates a pipeline with the four default stages and Linear defaults', async () => {
    const owner = await signUpTestUser();
    const team = await createTeam(owner, { key: 'ENG' });
    const p = await createPipeline(owner, { name: 'Production', teamIds: [team.team.id] });
    expect(p.type).toBe('continuous');
    expect(p.isProduction).toBe(true);
    expect(p.rolloverIssuesOnCompletion).toBe(true);
    expect(p.autoGenerateReleaseNotesOnCompletion).toBe(false);
    expect(p.includePathPatterns).toEqual([]);
    expect(p.slugId).toBe('production');
    expect(p.url).toEndWith('/team/ENG/releases/production');
    expect(p.teams.nodes.map((t: { key: string }) => t.key)).toEqual(['ENG']);
    expect(p.stages.nodes.map((s: { name: string; type: string }) => [s.name, s.type])).toEqual([
      ['Planned', 'planned'],
      ['In progress', 'started'],
      ['Completed', 'completed'],
      ['Canceled', 'canceled'],
    ]);
  });

  it('adds a suffix when the slug is taken', async () => {
    const owner = await signUpTestUser();
    const team = await createTeam(owner, { key: 'ENG' });
    await createPipeline(owner, { name: 'Production', teamIds: [team.team.id] });
    const second = await createPipeline(owner, { name: 'Production', teamIds: [team.team.id] });
    expect(second.slugId).not.toBe('production');
    expect(second.slugId).toStartWith('production-');
  });

  it('needs at least one team', async () => {
    const owner = await signUpTestUser();
    expect(await errorCode(owner, CREATE, { input: { name: 'P', teamIds: [] } })).toBe(
      'INVALID_INPUT',
    );
  });

  it('hides a private team pipeline from people outside the team', async () => {
    const owner = await signUpTestUser();
    const member = await signUpTestUser();
    const team = await createTeam(owner, { key: 'SEC', private: true });
    const p = await createPipeline(owner, { name: 'Secret', teamIds: [team.team.id] });
    expect(
      await errorCode(member, `query($id: String!) { releasePipeline(id: $id) { id } }`, {
        id: p.id,
      }),
    ).toBe('ENTITY_NOT_FOUND');
    const list = await gqlData(member, `{ releasePipelines { nodes { id } } }`);
    expect(list.releasePipelines.nodes).toEqual([]);
  });

  it('lets a guest of the team read but not create', async () => {
    const owner = await signUpTestUser();
    const guest = await signUpAs('guest');
    const team = await createTeam(owner, { key: 'ENG' });
    await addMember(owner, team.team.id, guest.userId);
    const p = await createPipeline(owner, { name: 'Production', teamIds: [team.team.id] });
    const read = await gqlData(guest, `query($id: String!) { releasePipeline(id: $id) { name } }`, {
      id: p.id,
    });
    expect(read.releasePipeline.name).toBe('Production');
    expect(await errorCode(guest, CREATE, { input: { name: 'G', teamIds: [team.team.id] } })).toBe(
      'FORBIDDEN',
    );
  });

  it('updates a pipeline', async () => {
    const owner = await signUpTestUser();
    const team = await createTeam(owner, { key: 'ENG' });
    const p = await createPipeline(owner, { name: 'Production', teamIds: [team.team.id] });
    const data = await gqlData(
      owner,
      `mutation($id: String!, $input: ReleasePipelineUpdateInput!) {
        releasePipelineUpdate(id: $id, input: $input) { releasePipeline { name isProduction includePathPatterns } }
      }`,
      {
        id: p.id,
        input: { name: 'Staging', isProduction: false, includePathPatterns: ['apps/**'] },
      },
    );
    expect(data.releasePipelineUpdate.releasePipeline).toEqual({
      name: 'Staging',
      isProduction: false,
      includePathPatterns: ['apps/**'],
    });
  });

  it('adds a started stage to a scheduled pipeline but not to a continuous one', async () => {
    const owner = await signUpTestUser();
    const team = await createTeam(owner, { key: 'ENG' });
    const scheduled = await createPipeline(owner, {
      name: 'Mobile',
      type: 'scheduled',
      teamIds: [team.team.id],
    });
    const continuous = await createPipeline(owner, { name: 'Web', teamIds: [team.team.id] });
    const STAGE = `mutation($input: ReleaseStageCreateInput!) {
      releaseStageCreate(input: $input) { releaseStage { name type frozen pipeline { id } } }
    }`;
    const qa = await gqlData(owner, STAGE, {
      input: {
        pipelineId: scheduled.id,
        name: 'QA',
        color: '#aabbcc',
        position: 1.5,
        type: 'started',
        frozen: true,
      },
    });
    expect(qa.releaseStageCreate.releaseStage).toEqual({
      name: 'QA',
      type: 'started',
      frozen: true,
      pipeline: { id: scheduled.id },
    });
    expect(
      await errorCode(owner, STAGE, {
        input: {
          pipelineId: continuous.id,
          name: 'QA',
          color: '#aabbcc',
          position: 1.5,
          type: 'started',
        },
      }),
    ).toBe('INVALID_INPUT');
    expect(
      await errorCode(owner, STAGE, {
        input: {
          pipelineId: scheduled.id,
          name: 'Done 2',
          color: '#aabbcc',
          position: 9,
          type: 'completed',
        },
      }),
    ).toBe('INVALID_INPUT');
  });

  it('keeps the only completed stage', async () => {
    const owner = await signUpTestUser();
    const team = await createTeam(owner, { key: 'ENG' });
    const p = await createPipeline(owner, {
      name: 'Mobile',
      type: 'scheduled',
      teamIds: [team.team.id],
    });
    const completed = p.stages.nodes.find((s: { type: string }) => s.type === 'completed');
    expect(
      await errorCode(
        owner,
        `mutation($id: String!) { releaseStageArchive(id: $id) { success } }`,
        {
          id: completed.id,
        },
      ),
    ).toBe('INVALID_INPUT');
  });

  it('renames a stage of a scheduled pipeline', async () => {
    const owner = await signUpTestUser();
    const team = await createTeam(owner, { key: 'ENG' });
    const p = await createPipeline(owner, {
      name: 'Mobile',
      type: 'scheduled',
      teamIds: [team.team.id],
    });
    const started = p.stages.nodes.find((s: { type: string }) => s.type === 'started');
    const data = await gqlData(
      owner,
      `mutation($id: String!, $input: ReleaseStageUpdateInput!) {
        releaseStageUpdate(id: $id, input: $input) { releaseStage { name color } }
      }`,
      { id: started.id, input: { name: 'Beta', color: '#123456' } },
    );
    expect(data.releaseStageUpdate.releaseStage).toEqual({ name: 'Beta', color: '#123456' });
  });

  it('trashes a pipeline on delete and leaves it out of lists', async () => {
    const owner = await signUpTestUser();
    const team = await createTeam(owner, { key: 'ENG' });
    const p = await createPipeline(owner, { name: 'Production', teamIds: [team.team.id] });
    const del = await gqlData(
      owner,
      `mutation($id: String!) { releasePipelineDelete(id: $id) { success entity { trashed } } }`,
      { id: p.id },
    );
    expect(del.releasePipelineDelete).toEqual({ success: true, entity: { trashed: true } });
    const list = await gqlData(owner, `{ releasePipelines { nodes { id } } }`);
    expect(list.releasePipelines.nodes).toEqual([]);
    const restored = await gqlData(
      owner,
      `mutation($id: String!) { releasePipelineUnarchive(id: $id) { success entity { trashed archivedAt } } }`,
      { id: p.id },
    );
    expect(restored.releasePipelineUnarchive.entity).toEqual({ trashed: false, archivedAt: null });
  });

  it('lists a team pipelines', async () => {
    const owner = await signUpTestUser();
    const eng = await createTeam(owner, { key: 'ENG' });
    const ops = await createTeam(owner, { key: 'OPS' });
    await createPipeline(owner, { name: 'Web', teamIds: [eng.team.id] });
    await createPipeline(owner, { name: 'Infra', teamIds: [ops.team.id] });
    const data = await gqlData(
      owner,
      `query($id: String!) { team(id: $id) { releasePipelines { nodes { name } } } }`,
      { id: eng.team.id },
    );
    expect(data.team.releasePipelines.nodes).toEqual([{ name: 'Web' }]);
  });
});
