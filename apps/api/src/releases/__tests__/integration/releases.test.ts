import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createTeam,
  gqlData,
  statesByType,
  type TeamView,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { countStatements } from '../../../__tests__/helpers/statements';

// Linear's releases and their issues (releases/store.ts, issues.ts, progress.ts).

const RELEASE_FIELDS = `id name version slugId url description commitSha startDate targetDate
  startedAt completedAt canceledAt archivedAt trashed
  stage { id name type } pipeline { id }
  issueCount currentProgress
  issues { nodes { identifier } }
  links { nodes { url label } }
  documents { nodes { title content url } }`;

async function errorCode(as: TestUser, query: string, variables?: Record<string, unknown>) {
  const res = await gql({ cookie: as.cookie }, query, variables);
  return res.body.errors?.[0]?.extensions?.code;
}

interface Setup {
  owner: TestUser;
  team: TeamView;
  pipeline: { id: string; slugId: string; stages: Record<string, string> };
}

async function setup(type: 'continuous' | 'scheduled', extra: Record<string, unknown> = {}) {
  const owner = await signUpTestUser();
  const team = await createTeam(owner, { key: 'ENG' });
  const data = await gqlData(
    owner,
    `mutation($input: ReleasePipelineCreateInput!) {
      releasePipelineCreate(input: $input) {
        releasePipeline { id slugId stages { nodes { id name } } }
      }
    }`,
    { input: { name: 'Production', type, teamIds: [team.team.id], ...extra } },
  );
  const p = data.releasePipelineCreate.releasePipeline;
  const stages: Record<string, string> = {};
  for (const s of p.stages.nodes) stages[s.name] = s.id;
  return { owner, team, pipeline: { id: p.id, slugId: p.slugId, stages } } satisfies Setup;
}

async function createRelease(as: TestUser, input: Record<string, unknown>) {
  const data = await gqlData(
    as,
    `mutation($input: ReleaseCreateInput!) {
      releaseCreate(input: $input) { success release { ${RELEASE_FIELDS} } }
    }`,
    { input },
  );
  return data.releaseCreate.release;
}

async function updateRelease(as: TestUser, id: string, input: Record<string, unknown>) {
  const data = await gqlData(
    as,
    `mutation($id: String!, $input: ReleaseUpdateInput!) {
      releaseUpdate(id: $id, input: $input) { release { ${RELEASE_FIELDS} } }
    }`,
    { id, input },
  );
  return data.releaseUpdate.release;
}

async function readRelease(as: TestUser, id: string) {
  const data = await gqlData(as, `query($id: String!) { release(id: $id) { ${RELEASE_FIELDS} } }`, {
    id,
  });
  return data.release;
}

async function link(as: TestUser, issueId: string, releaseId: string) {
  const data = await gqlData(
    as,
    `mutation($input: IssueToReleaseCreateInput!) {
      issueToReleaseCreate(input: $input) { success issueToRelease { id issue { id } release { id } } }
    }`,
    { input: { issueId, releaseId } },
  );
  return data.issueToReleaseCreate.issueToRelease;
}

const identifiers = (r: { issues: { nodes: { identifier: string }[] } }) =>
  r.issues.nodes.map((i) => i.identifier).sort();

describe('releases', () => {
  beforeEach(resetDb);

  it('starts a scheduled release in its first started stage, or the stage given', async () => {
    const { owner, pipeline } = await setup('scheduled');
    const r = await createRelease(owner, { name: 'v1.0', pipelineId: pipeline.id });
    expect(r.stage.name).toBe('In progress');
    expect(r.startedAt).not.toBeNull();
    expect(r.completedAt).toBeNull();
    expect(r.slugId).toBeTruthy();
    expect(r.url).toEndWith(`/team/ENG/releases/${pipeline.slugId}/${r.slugId}`);
    const planned = await createRelease(owner, {
      name: 'v1.1',
      pipelineId: pipeline.id,
      stageId: pipeline.stages.Planned,
    });
    expect(planned.stage.type).toBe('planned');
    expect(planned.startedAt).toBeNull();
  });

  it('creates a continuous release completed', async () => {
    const { owner, pipeline } = await setup('continuous');
    const r = await createRelease(owner, { name: 'abc1234', pipelineId: pipeline.id });
    expect(r.stage.type).toBe('completed');
    expect(r.completedAt).not.toBeNull();
  });

  it('sets the stage times when the stage changes', async () => {
    const { owner, pipeline } = await setup('scheduled');
    const r = await createRelease(owner, {
      name: 'v1.0',
      pipelineId: pipeline.id,
      stageId: pipeline.stages.Planned,
    });
    const started = await updateRelease(owner, r.id, { stageId: pipeline.stages['In progress'] });
    expect(started.startedAt).not.toBeNull();
    const canceled = await updateRelease(owner, r.id, { stageId: pipeline.stages.Canceled });
    expect(canceled.canceledAt).not.toBeNull();
    expect(canceled.stage.type).toBe('canceled');
  });

  it('refuses a stage of another pipeline and a repeated version', async () => {
    const { owner, team, pipeline } = await setup('scheduled');
    const second = await gqlData(
      owner,
      `mutation($input: ReleasePipelineCreateInput!) {
        releasePipelineCreate(input: $input) { releasePipeline { stages { nodes { id } } } }
      }`,
      {
        input: {
          name: 'Staging',
          type: 'scheduled',
          teamIds: [team.team.id],
        },
      },
    );
    const foreignStage = second.releasePipelineCreate.releasePipeline.stages.nodes[0].id;
    expect(
      await errorCode(
        owner,
        `mutation($input: ReleaseCreateInput!) { releaseCreate(input: $input) { success } }`,
        { input: { name: 'x', pipelineId: pipeline.id, stageId: foreignStage } },
      ),
    ).toBe('INVALID_INPUT');
    await createRelease(owner, { name: 'v1', version: '1.0.0', pipelineId: pipeline.id });
    expect(
      await errorCode(
        owner,
        `mutation($input: ReleaseCreateInput!) { releaseCreate(input: $input) { success } }`,
        { input: { name: 'again', version: '1.0.0', pipelineId: pipeline.id } },
      ),
    ).toBe('CONFLICT');
  });

  it('links issues by id or identifier, once, and only from the pipeline teams', async () => {
    const { owner, pipeline } = await setup('scheduled');
    const r = await createRelease(owner, { name: 'v1.0', pipelineId: pipeline.id });
    const a = await createIssue(owner, { teamId: 'ENG', title: 'A' });
    const b = await createIssue(owner, { teamId: 'ENG', title: 'B' });
    await link(owner, a.id, r.id);
    await link(owner, b.identifier, r.id);
    expect(
      await errorCode(
        owner,
        `mutation($input: IssueToReleaseCreateInput!) { issueToReleaseCreate(input: $input) { success } }`,
        { input: { issueId: a.id, releaseId: r.id } },
      ),
    ).toBe('CONFLICT');
    await createTeam(owner, { key: 'OPS' });
    const outside = await createIssue(owner, { teamId: 'OPS', title: 'Elsewhere' });
    expect(
      await errorCode(
        owner,
        `mutation($input: IssueToReleaseCreateInput!) { issueToReleaseCreate(input: $input) { success } }`,
        { input: { issueId: outside.id, releaseId: r.id } },
      ),
    ).toBe('INVALID_INPUT');
    const read = await readRelease(owner, r.id);
    expect(identifiers(read)).toEqual([a.identifier, b.identifier].sort());
    expect(read.issueCount).toBe(2);
    const issue = await gqlData(
      owner,
      `query($id: String!) { issue(id: $id) { releases { nodes { id } } } }`,
      { id: a.id },
    );
    expect(issue.issue.releases.nodes.map((n: { id: string }) => n.id)).toEqual([r.id]);
  });

  it('removes an issue by link id or by issue and release', async () => {
    const { owner, pipeline } = await setup('scheduled');
    const r = await createRelease(owner, { name: 'v1.0', pipelineId: pipeline.id });
    const a = await createIssue(owner, { teamId: 'ENG', title: 'A' });
    const b = await createIssue(owner, { teamId: 'ENG', title: 'B' });
    const la = await link(owner, a.id, r.id);
    await link(owner, b.id, r.id);
    await gqlData(owner, `mutation($id: String!) { issueToReleaseDelete(id: $id) { success } }`, {
      id: la.id,
    });
    await gqlData(
      owner,
      `mutation($i: String!, $r: String!) {
        issueToReleaseDeleteByIssueAndRelease(issueId: $i, releaseId: $r) { success }
      }`,
      { i: b.identifier, r: r.id },
    );
    expect((await readRelease(owner, r.id)).issueCount).toBe(0);
  });

  it('reports progress by the project rule and counts by state type', async () => {
    const { owner, team, pipeline } = await setup('scheduled');
    const states = statesByType(team);
    const r = await createRelease(owner, { name: 'v1.0', pipelineId: pipeline.id });
    const done = await createIssue(owner, { teamId: 'ENG', stateId: states.completed });
    const doing = await createIssue(owner, { teamId: 'ENG', stateId: states.started });
    const todo = await createIssue(owner, { teamId: 'ENG' });
    for (const i of [done, doing, todo]) await link(owner, i.id, r.id);
    const p = (await readRelease(owner, r.id)).currentProgress;
    expect(p.issueCount).toBe(3);
    expect(p.completedIssueCount).toBe(1);
    expect(p.progress).toBeCloseTo((1 + 0.25) / 3, 5);
    expect(p.stateTypeCounts.completed).toBe(1);
    expect(p.stateTypeCounts.started).toBe(1);
  });

  it('completes the latest started release and rolls unfinished issues into the earliest planned one', async () => {
    const { owner, team, pipeline } = await setup('scheduled');
    const states = statesByType(team);
    const current = await createRelease(owner, { name: 'v1.0', pipelineId: pipeline.id });
    const later = await createRelease(owner, {
      name: 'v1.2',
      pipelineId: pipeline.id,
      stageId: pipeline.stages.Planned,
      targetDate: '2030-06-01',
    });
    const next = await createRelease(owner, {
      name: 'v1.1',
      pipelineId: pipeline.id,
      stageId: pipeline.stages.Planned,
      targetDate: '2030-01-01',
    });
    const done = await createIssue(owner, { teamId: 'ENG', stateId: states.completed });
    const open = await createIssue(owner, { teamId: 'ENG' });
    const dropped = await createIssue(owner, { teamId: 'ENG', stateId: states.canceled });
    for (const i of [done, open, dropped]) await link(owner, i.id, current.id);
    const data = await gqlData(
      owner,
      `mutation($input: ReleaseCompleteInput!) {
        releaseComplete(input: $input) { release { id completedAt stage { type } } }
      }`,
      { input: { pipelineId: pipeline.id } },
    );
    expect(data.releaseComplete.release.id).toBe(current.id);
    expect(data.releaseComplete.release.completedAt).not.toBeNull();
    expect(data.releaseComplete.release.stage.type).toBe('completed');
    expect(identifiers(await readRelease(owner, current.id))).toEqual(
      [done.identifier, dropped.identifier].sort(),
    );
    expect(identifiers(await readRelease(owner, next.id))).toEqual([open.identifier]);
    expect((await readRelease(owner, later.id)).issueCount).toBe(0);
  });

  it('creates a "Next" release for rolled-over issues when none is planned', async () => {
    const { owner, pipeline } = await setup('scheduled');
    const current = await createRelease(owner, { name: 'v1.0', pipelineId: pipeline.id });
    const open = await createIssue(owner, { teamId: 'ENG' });
    await link(owner, open.id, current.id);
    await updateRelease(owner, current.id, { stageId: pipeline.stages.Completed });
    const list = await gqlData(
      owner,
      `query($id: String!) {
        releasePipeline(id: $id) { releases { nodes { name stage { type } issues { nodes { identifier } } } } }
      }`,
      { id: pipeline.id },
    );
    const nextRelease = list.releasePipeline.releases.nodes.find(
      (n: { name: string }) => n.name === 'Next',
    );
    expect(nextRelease.stage.type).toBe('planned');
    expect(identifiers(nextRelease)).toEqual([open.identifier]);
  });

  it('keeps unfinished issues when rollover is off', async () => {
    const { owner, pipeline } = await setup('scheduled', { rolloverIssuesOnCompletion: false });
    const current = await createRelease(owner, { name: 'v1.0', pipelineId: pipeline.id });
    const open = await createIssue(owner, { teamId: 'ENG' });
    await link(owner, open.id, current.id);
    await updateRelease(owner, current.id, { stageId: pipeline.stages.Completed });
    expect(identifiers(await readRelease(owner, current.id))).toEqual([open.identifier]);
  });

  it('updates by pipeline: by version, else the latest started, else the earliest planned', async () => {
    const { owner, pipeline } = await setup('scheduled');
    const planned = await createRelease(owner, {
      name: 'planned',
      pipelineId: pipeline.id,
      stageId: pipeline.stages.Planned,
      targetDate: '2030-01-01',
    });
    const byPipeline = (input: Record<string, unknown>) =>
      gqlData(
        owner,
        `mutation($input: ReleaseUpdateByPipelineInput!) {
          releaseUpdateByPipeline(input: $input) { release { id name stage { name } links { nodes { url label } } } }
        }`,
        { input: { pipelineId: pipeline.id, ...input } },
      ).then((d) => d.releaseUpdateByPipeline.release);
    expect((await byPipeline({ description: 'x' })).id).toBe(planned.id);
    const started = await createRelease(owner, { name: 'started', pipelineId: pipeline.id });
    expect((await byPipeline({ description: 'y' })).id).toBe(started.id);
    const versioned = await createRelease(owner, {
      name: 'versioned',
      version: '2.0.0',
      pipelineId: pipeline.id,
      stageId: pipeline.stages.Planned,
    });
    const moved = await byPipeline({
      version: '2.0.0',
      stage: 'in PROGRESS',
      links: [{ url: 'https://ci.example.com/run/1', label: 'CI run' }],
    });
    expect(moved.id).toBe(versioned.id);
    expect(moved.stage.name).toBe('In progress');
    const relinked = await byPipeline({
      version: '2.0.0',
      links: [{ url: 'https://ci.example.com/run/1', label: 'CI run #1' }],
      documents: [{ title: 'Changelog', content: '- one' }],
    });
    expect(relinked.links.nodes).toEqual([
      { url: 'https://ci.example.com/run/1', label: 'CI run #1' },
    ]);
    const read = await readRelease(owner, versioned.id);
    expect(read.documents.nodes.map((d: { title: string }) => d.title)).toEqual(['Changelog']);
    expect(read.documents.nodes[0].url).toEndWith(read.url.replace(/^.*\/team\//, '/team/'));
  });

  it('lists releases of a pipeline and of a stage, archives and trashes them', async () => {
    const { owner, pipeline } = await setup('scheduled');
    const a = await createRelease(owner, { name: 'a', pipelineId: pipeline.id });
    const b = await createRelease(owner, {
      name: 'b',
      pipelineId: pipeline.id,
      stageId: pipeline.stages.Planned,
    });
    const stage = await gqlData(
      owner,
      `query($id: String!) { releaseStage(id: $id) { releases { nodes { id } } } }`,
      { id: pipeline.stages.Planned },
    );
    expect(stage.releaseStage.releases.nodes.map((n: { id: string }) => n.id)).toEqual([b.id]);
    await gqlData(owner, `mutation($id: String!) { releaseDelete(id: $id) { success } }`, {
      id: a.id,
    });
    const trashed = await readRelease(owner, a.id);
    expect(trashed.trashed).toBe(true);
    const list = await gqlData(owner, `{ releases { nodes { id } } }`);
    expect(list.releases.nodes.map((n: { id: string }) => n.id)).toEqual([b.id]);
    await gqlData(owner, `mutation($id: String!) { releaseUnarchive(id: $id) { success } }`, {
      id: a.id,
    });
    expect((await readRelease(owner, a.id)).trashed).toBe(false);
  });

  it('searches by name, version and pipeline name', async () => {
    const { owner, pipeline } = await setup('scheduled');
    await createRelease(owner, { name: 'Spring', version: '3.1.0', pipelineId: pipeline.id });
    await createRelease(owner, { name: 'Autumn', pipelineId: pipeline.id });
    const search = (term: string) =>
      gqlData(owner, `query($t: String) { releaseSearch(term: $t) { name } }`, { t: term }).then(
        (d) => d.releaseSearch.map((r: { name: string }) => r.name).sort(),
      );
    expect(await search('spr')).toEqual(['Spring']);
    expect(await search('3.1')).toEqual(['Spring']);
    expect(await search('production')).toEqual(['Autumn', 'Spring']);
  });

  it('hides releases of a private team from people outside it', async () => {
    const owner = await signUpTestUser();
    const member = await signUpTestUser();
    const team = await createTeam(owner, { key: 'SEC', private: true });
    const data = await gqlData(
      owner,
      `mutation($input: ReleasePipelineCreateInput!) {
        releasePipelineCreate(input: $input) { releasePipeline { id } }
      }`,
      { input: { name: 'Secret', teamIds: [team.team.id] } },
    );
    const r = await createRelease(owner, {
      name: 'v1',
      pipelineId: data.releasePipelineCreate.releasePipeline.id,
    });
    expect(
      await errorCode(member, `query($id: String!) { release(id: $id) { id } }`, { id: r.id }),
    ).toBe('ENTITY_NOT_FOUND');
    expect((await gqlData(member, `{ releases { nodes { id } } }`)).releases.nodes).toEqual([]);
  });
});

describe('release lists', () => {
  beforeEach(resetDb);

  it("reads a pipeline's releases with a bounded number of statements", async () => {
    const { owner, pipeline } = await setup('continuous');
    for (let n = 0; n < 8; n++)
      await createRelease(owner, { name: `r${n}`, version: `${n}`, pipelineId: pipeline.id });
    const query = () =>
      gqlData(
        owner,
        `query($id: String!) { releasePipeline(id: $id) {
          releases { nodes { id name url issueCount stage { id name type color } pipeline { id } } }
        } }`,
        { id: pipeline.id },
      );
    const data = await query();
    expect(data.releasePipeline.releases.nodes).toHaveLength(8);
    expect(data.releasePipeline.releases.nodes[0].url).toContain('/releases/');
    // A per-release query would add at least 8 statements per field.
    expect(await countStatements(query)).toBeLessThanOrEqual(16);
  });
});

describe('slug lookups', () => {
  beforeEach(resetDb);

  it('reads a pipeline and a release by their slugs', async () => {
    const { owner, pipeline } = await setup('scheduled');
    const created = await createRelease(owner, { name: 'v1.0', pipelineId: pipeline.id });
    const data = await gqlData(
      owner,
      `query($p: String!, $r: String!) {
        releasePipeline(id: $p) { id }
        release(id: $r) { id }
      }`,
      { p: pipeline.slugId, r: created.slugId },
    );
    expect(data.releasePipeline.id).toBe(pipeline.id);
    expect(data.release.id).toBe(created.id);
  });
});
