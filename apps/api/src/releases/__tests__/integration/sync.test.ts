import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  archiveIssue,
  createIssue,
  createTeam,
  gqlData,
  signUpAs,
  type Data,
  type TeamView,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { instance, ok } from '../../../portal/__tests__/helpers';

// Release sync from CI (releases/sync.ts, keys.ts): access keys, releaseSync and the
// *ByAccessKey operations, and the GraphQL credential that only reaches those.

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SHA2 = 'ffeeddccbbaa99887766554433221100ffeeddcc';

const SYNC = `mutation($input: ReleaseSyncInputBase!) {
  releaseSyncByAccessKey(input: $input) {
    success release { id name version commitSha completedAt url stage { name type } }
  }
}`;

interface Setup {
  owner: TestUser;
  team: TeamView;
  pipeline: { id: string; stages: Record<string, string> };
  key: string;
}

async function setup(
  type: 'continuous' | 'scheduled',
  existing?: { owner: TestUser; key: string },
): Promise<Setup> {
  const owner = existing?.owner ?? (await signUpTestUser());
  const team = await createTeam(owner, { key: existing?.key ?? 'ENG' });
  const data = await gqlData(
    owner,
    `mutation($input: ReleasePipelineCreateInput!) {
      releasePipelineCreate(input: $input) {
        releasePipeline { id stages { nodes { id name } } }
      }
    }`,
    { input: { name: 'Production', type, teamIds: [team.team.id] } },
  );
  const p = data.releasePipelineCreate.releasePipeline;
  const stages: Record<string, string> = {};
  for (const s of p.stages.nodes) stages[s.name] = s.id;
  const created = await ok(await instance('access-keys/create', owner, { pipelineId: p.id }));
  return { owner, team, pipeline: { id: p.id, stages }, key: created.key };
}

const withKey = (key: string) => ({ authorization: `Bearer ${key}` });

async function sync(key: string, input: Record<string, unknown>) {
  return gql(withKey(key), SYNC, { input });
}

async function syncOk(key: string, input: Record<string, unknown>) {
  const res = await sync(key, input);
  if (res.body.errors) throw new Error(JSON.stringify(res.body.errors));
  return (res.body.data as { releaseSyncByAccessKey: { release: Data } }).releaseSyncByAccessKey
    .release;
}

async function releaseIssues(as: TestUser, id: string): Promise<string[]> {
  const data = await gqlData(
    as,
    `query($id: String!) { release(id: $id) { issues { nodes { identifier } } } }`,
    { id },
  );
  return data.release.issues.nodes.map((n: { identifier: string }) => n.identifier).sort();
}

const ref = (identifier: string, commitSha = SHA) => ({ identifier, commitSha });

beforeEach(resetDb);

describe('access keys', () => {
  it('lets owners and admins create a key, shown once, and lists it without the key', async () => {
    const s = await setup('continuous');
    expect(s.key).toStartWith('itpr_');
    const admin = await signUpAs('admin');
    await addMember(s.owner, s.team.team.id, admin.userId);
    const second = await ok(
      await instance('access-keys/create', admin, { pipelineId: s.pipeline.id }),
    );
    expect(second.key).not.toBe(s.key);
    const member = await signUpAs('member');
    const refused = await instance('access-keys/create', member, { pipelineId: s.pipeline.id });
    expect(refused.status).toBe(403);
    const list = await ok(await instance(`access-keys?pipelineId=${s.pipeline.id}`, member));
    expect(list.accessKeys).toHaveLength(2);
    expect(JSON.stringify(list)).not.toContain('itpr_');
    await syncOk(s.key, { commitSha: SHA });
    const after = await ok(await instance(`access-keys?pipelineId=${s.pipeline.id}`, s.owner));
    expect(after.accessKeys.some((k: { lastUsedAt: string | null }) => k.lastUsedAt)).toBe(true);
  });

  it('refuses a key for anything but the access key operations', async () => {
    const s = await setup('continuous');
    const issues = await gql(withKey(s.key), '{ issues { nodes { id } } }');
    expect(issues.status).toBe(401);
    expect(issues.body.errors?.[0]?.extensions?.code).toBe('AUTHENTICATION_ERROR');
    const userSync = await gql(
      withKey(s.key),
      `mutation($input: ReleaseSyncInput!) { releaseSync(input: $input) { success } }`,
      { input: { pipelineId: s.pipeline.id, commitSha: SHA } },
    );
    expect(userSync.status).toBe(401);
    const mixed = await gql(withKey(s.key), '{ releasePipelineByAccessKey { id } viewer { id } }');
    expect(mixed.status).toBe(401);
    const asApiKey = await gql({ 'x-api-key': s.key }, '{ viewer { id } }');
    expect(asApiKey.status).toBe(401);
  });

  it('refuses a revoked key and a key of a deleted pipeline', async () => {
    const s = await setup('continuous');
    const list = await ok(await instance(`access-keys?pipelineId=${s.pipeline.id}`, s.owner));
    await ok(await instance('access-keys/revoke', s.owner, { id: list.accessKeys[0].id }));
    expect((await sync(s.key, { commitSha: SHA })).status).toBe(401);
    const t = await setup('continuous', { owner: s.owner, key: 'WEB' });
    await gqlData(
      t.owner,
      `mutation($id: String!) { releasePipelineDelete(id: $id) { success } }`,
      { id: t.pipeline.id },
    );
    expect((await sync(t.key, { commitSha: SHA })).status).toBe(401);
  });

  it('refuses the access key operations without a key', async () => {
    const s = await setup('continuous');
    const res = await gql({ cookie: s.owner.cookie }, SYNC, { input: { commitSha: SHA } });
    expect(res.body.errors?.[0]?.extensions?.code).toBe('AUTHENTICATION_ERROR');
  });

  it('reads the key pipeline and its releases', async () => {
    const s = await setup('continuous');
    await syncOk(s.key, { commitSha: SHA });
    await syncOk(s.key, { commitSha: SHA2 });
    const res = await gql(
      withKey(s.key),
      `{ releasePipelineByAccessKey { id includePathPatterns }
         latestReleaseByAccessKey { version }
         recentReleasesByAccessKey(limit: 5) { version stage { type } } }`,
    );
    const data = res.body.data as Data;
    expect(data.releasePipelineByAccessKey.id).toBe(s.pipeline.id);
    expect(data.latestReleaseByAccessKey.version).toBe(SHA2.slice(0, 7));
    expect(data.recentReleasesByAccessKey.map((r: { version: string }) => r.version)).toEqual([
      SHA2.slice(0, 7),
      SHA.slice(0, 7),
    ]);
  });
});

describe('continuous sync', () => {
  it('creates a completed release named after the commit with its issues', async () => {
    const s = await setup('continuous');
    await createIssue(s.owner, { teamId: 'ENG', title: 'One' });
    const r = await syncOk(s.key, { commitSha: SHA, issueReferences: [ref('ENG-1')] });
    expect(r.version).toBe(SHA.slice(0, 7));
    expect(r.name).toBe(SHA.slice(0, 7));
    expect(r.commitSha).toBe(SHA);
    expect(r.stage.type).toBe('completed');
    expect(r.completedAt).toBeTruthy();
    expect(await releaseIssues(s.owner, r.id)).toEqual(['ENG-1']);
  });

  it('gives one release and one link when the same sync runs twice', async () => {
    const s = await setup('continuous');
    await createIssue(s.owner, { teamId: 'ENG', title: 'One' });
    const input = { commitSha: SHA, issueReferences: [ref('ENG-1')] };
    const first = await syncOk(s.key, input);
    const second = await syncOk(s.key, input);
    expect(second.id).toBe(first.id);
    const data = await gqlData(
      s.owner,
      `query($id: String!) { releasePipeline(id: $id) { releases { nodes { id issueCount } } } }`,
      { id: s.pipeline.id },
    );
    expect(data.releasePipeline.releases.nodes).toEqual([{ id: first.id, issueCount: 1 }]);
  });

  it('matches identifiers in any case and skips unknown, archived and other teams', async () => {
    const s = await setup('continuous');
    await createIssue(s.owner, { teamId: 'ENG', title: 'One' });
    const gone = await createIssue(s.owner, { teamId: 'ENG', title: 'Two' });
    await archiveIssue(s.owner, gone.id);
    await createTeam(s.owner, { key: 'OPS' });
    await createIssue(s.owner, { teamId: 'OPS', title: 'Elsewhere' });
    const r = await syncOk(s.key, {
      commitSha: SHA,
      issueReferences: [ref('eng-1'), ref('ENG-2'), ref('OPS-1'), ref('NOPE-9')],
    });
    expect(await releaseIssues(s.owner, r.id)).toEqual(['ENG-1']);
  });

  it('refuses a repeated version with another commit', async () => {
    const s = await setup('continuous');
    await syncOk(s.key, { commitSha: SHA, version: '1.0.0' });
    const res = await sync(s.key, { commitSha: SHA2, version: '1.0.0' });
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
  });

  it('keeps links, documents, notes and the repository of the sync', async () => {
    const s = await setup('continuous');
    const r = await syncOk(s.key, {
      commitSha: SHA,
      name: 'Deploy 42',
      links: [{ url: 'https://ci.example.com/run/42', label: 'CI run' }, { url: 'nope' }],
      documents: [{ title: 'Changelog', content: '- one' }],
      releaseNotes: { title: 'Notes', content: 'Shipped one.' },
      repository: {
        owner: 'acme',
        name: 'app',
        provider: 'github',
        url: 'https://github.com/acme/app',
      },
      pullRequestReferences: [],
    });
    expect(r.name).toBe('Deploy 42');
    const data = await gqlData(
      s.owner,
      `query($id: String!) { release(id: $id) {
        links { nodes { url label } } documents { nodes { title content } }
      } }`,
      { id: r.id },
    );
    expect(data.release.links.nodes).toEqual([
      { url: 'https://ci.example.com/run/42', label: 'CI run' },
    ]);
    expect(data.release.documents.nodes).toEqual([{ title: 'Changelog', content: '- one' }]);
  });
});

describe('scheduled sync', () => {
  async function scheduledRelease(s: Setup, input: Record<string, unknown>) {
    const data = await gqlData(
      s.owner,
      `mutation($input: ReleaseCreateInput!) { releaseCreate(input: $input) { release { id } } }`,
      { input: { pipelineId: s.pipeline.id, ...input } },
    );
    return data.releaseCreate.release.id as string;
  }

  it('adds issues to the started release', async () => {
    const s = await setup('scheduled');
    await createIssue(s.owner, { teamId: 'ENG', title: 'One' });
    const started = await scheduledRelease(s, { name: 'v2.3', version: '2.3' });
    const r = await syncOk(s.key, { commitSha: SHA, issueReferences: [ref('ENG-1')] });
    expect(r.id).toBe(started);
    expect(r.stage.type).toBe('started');
    expect(r.commitSha).toBe(SHA);
    expect(await releaseIssues(s.owner, started)).toEqual(['ENG-1']);
  });

  it('keeps the stored commit when asked', async () => {
    const s = await setup('scheduled');
    await scheduledRelease(s, { name: 'v2.3', version: '2.3', commitSha: SHA });
    const r = await syncOk(s.key, { commitSha: SHA2, preserveStoredCommitSha: true });
    expect(r.commitSha).toBe(SHA);
  });

  it('sends issues aimed at a frozen release to the next open one', async () => {
    const s = await setup('scheduled');
    await createIssue(s.owner, { teamId: 'ENG', title: 'One' });
    const qa = await gqlData(
      s.owner,
      `mutation($input: ReleaseStageCreateInput!) { releaseStageCreate(input: $input) { releaseStage { id } } }`,
      {
        input: {
          pipelineId: s.pipeline.id,
          name: 'Code freeze',
          color: '#ff0000',
          type: 'started',
          frozen: true,
          position: 1500,
        },
      },
    );
    const frozen = await scheduledRelease(s, {
      name: 'v2.3',
      version: '2.3',
      stageId: qa.releaseStageCreate.releaseStage.id,
    });
    const r = await syncOk(s.key, {
      commitSha: SHA,
      version: '2.3',
      issueReferences: [ref('ENG-1')],
    });
    expect(r.id).not.toBe(frozen);
    expect(r.stage.type).toBe('planned');
    expect(await releaseIssues(s.owner, frozen)).toEqual([]);
    expect(await releaseIssues(s.owner, r.id)).toEqual(['ENG-1']);
  });

  it('removes reverted issues from the release', async () => {
    const s = await setup('scheduled');
    await createIssue(s.owner, { teamId: 'ENG', title: 'One' });
    await createIssue(s.owner, { teamId: 'ENG', title: 'Two' });
    const started = await scheduledRelease(s, { name: 'v2.3' });
    await syncOk(s.key, { commitSha: SHA, issueReferences: [ref('ENG-1'), ref('ENG-2')] });
    await syncOk(s.key, { commitSha: SHA2, revertedIssueReferences: [ref('ENG-2', SHA2)] });
    expect(await releaseIssues(s.owner, started)).toEqual(['ENG-1']);
  });

  it('creates a planned release when none is open', async () => {
    const s = await setup('scheduled');
    const r = await syncOk(s.key, { commitSha: SHA });
    expect(r.stage.type).toBe('planned');
    expect(r.name).toBe('Next');
  });
});

describe('by-pipeline operations', () => {
  it('updates and completes the release through the key', async () => {
    const s = await setup('scheduled');
    await gqlData(
      s.owner,
      `mutation($input: ReleaseCreateInput!) { releaseCreate(input: $input) { release { id } } }`,
      { input: { pipelineId: s.pipeline.id, name: 'v2.3', version: '2.3' } },
    );
    const updated = await gql(
      withKey(s.key),
      `mutation($input: ReleaseUpdateByPipelineInputBase!) {
        releaseUpdateByPipelineByAccessKey(input: $input) { release { name stage { name } } }
      }`,
      { input: { version: '2.3', name: 'v2.3 final' } },
    );
    expect((updated.body.data as Data).releaseUpdateByPipelineByAccessKey.release.name).toBe(
      'v2.3 final',
    );
    const done = await gql(
      withKey(s.key),
      `mutation($input: ReleaseCompleteInputBase!) {
        releaseCompleteByAccessKey(input: $input) { release { completedAt stage { type } } }
      }`,
      { input: { version: '2.3' } },
    );
    const release = (done.body.data as Data).releaseCompleteByAccessKey.release;
    expect(release.stage.type).toBe('completed');
    expect(release.completedAt).toBeTruthy();
  });

  it('lets a team member run releaseSync with their session', async () => {
    const s = await setup('continuous');
    const member = await signUpAs('member');
    await addMember(s.owner, s.team.team.id, member.userId);
    await createIssue(s.owner, { teamId: 'ENG', title: 'One' });
    const data = await gqlData(
      member,
      `mutation($input: ReleaseSyncInput!) {
        releaseSync(input: $input) { release { version issues { nodes { identifier } } } }
      }`,
      { input: { pipelineId: s.pipeline.id, commitSha: SHA, issueReferences: [ref('ENG-1')] } },
    );
    expect(data.releaseSync.release.version).toBe(SHA.slice(0, 7));
    expect(data.releaseSync.release.issues.nodes).toEqual([{ identifier: 'ENG-1' }]);
    const guest = await signUpAs('guest');
    await addMember(s.owner, s.team.team.id, guest.userId);
    const res = await gql(
      { cookie: guest.cookie },
      `mutation($input: ReleaseSyncInput!) { releaseSync(input: $input) { success } }`,
      { input: { pipelineId: s.pipeline.id, commitSha: SHA2 } },
    );
    expect(res.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
