import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openReleasesFor, releaseLabel, shortCommit, stageOrder } from '@/utils/releases';
import { pipelinePath, releasePath, teamReleasesPath } from '@/utils/paths';

const stage = (id: string, type: string, position: number) => ({
  id,
  name: id,
  type,
  color: '#000000',
  position,
  frozen: false,
});

describe('stageOrder', () => {
  it('puts planned first, started by position, then completed and canceled', () => {
    const stages = [
      stage('done', 'completed', 0),
      stage('qa', 'started', 3),
      stage('canceled', 'canceled', 1),
      stage('planned', 'planned', 9),
      stage('progress', 'started', 2),
    ];
    assert.deepEqual(
      stageOrder(stages).map((s) => s.id),
      ['planned', 'progress', 'qa', 'done', 'canceled'],
    );
  });
});

describe('releaseLabel', () => {
  it('shows the name, else the version, else a placeholder', () => {
    assert.equal(releaseLabel({ name: 'Spring launch', version: '2.3.0' }), 'Spring launch');
    assert.equal(releaseLabel({ name: '', version: 'a1b2c3d' }), 'a1b2c3d');
    assert.equal(releaseLabel({ name: ' ', version: null }), 'Untitled release');
  });
});

describe('release paths', () => {
  it('builds the team, pipeline and release paths', () => {
    assert.equal(teamReleasesPath('ENG'), '/team/ENG/releases');
    assert.equal(pipelinePath('ENG', 'production'), '/team/ENG/releases/production');
    assert.equal(
      releasePath('ENG', 'production', 'v1-abc123'),
      '/team/ENG/releases/production/v1-abc123',
    );
  });
});

describe('openReleasesFor', () => {
  const release = (
    id: string,
    stageType: string,
    opts: { frozen?: boolean; pipeline?: string; name?: string; issueIds?: string[] } = {},
  ) => ({
    id,
    name: opts.name ?? id,
    version: null,
    stage: { ...stage(`${id}-stage`, stageType, 0), frozen: opts.frozen ?? false },
    pipeline: { id: opts.pipeline ?? 'p1', slugId: 'p', name: opts.pipeline ?? 'Production' },
  });

  it('leaves out completed and canceled releases and those the issue is in', () => {
    const list = [
      release('done', 'completed'),
      release('dropped', 'canceled'),
      release('mine', 'started'),
      release('open', 'planned'),
    ];
    assert.deepEqual(
      openReleasesFor(list, new Set(['mine'])).map((r) => r.id),
      ['open'],
    );
  });

  it('lists started before planned and frozen ones last', () => {
    const list = [
      release('planned', 'planned'),
      release('frozen', 'started', { frozen: true }),
      release('started', 'started'),
    ];
    assert.deepEqual(
      openReleasesFor(list, new Set()).map((r) => r.id),
      ['started', 'planned', 'frozen'],
    );
  });

  it('orders ties by pipeline name, then release name', () => {
    const list = [
      release('b', 'started', { pipeline: 'Web', name: 'v2' }),
      release('a', 'started', { pipeline: 'iOS', name: 'v9' }),
      release('c', 'started', { pipeline: 'Web', name: 'v1' }),
    ];
    assert.deepEqual(
      openReleasesFor(list, new Set()).map((r) => r.id),
      ['a', 'c', 'b'],
    );
  });
});

describe('shortCommit', () => {
  it('shows the first 7 characters of the commit', () => {
    assert.equal(shortCommit('0123456789abcdef', '2.3.0'), '0123456');
  });
  it('hides a commit that repeats the version', () => {
    assert.equal(shortCommit('8d34b3e1234567890', '8d34b3e'), null);
  });
  it('hides a missing commit', () => {
    assert.equal(shortCommit(null, '2.3.0'), null);
  });
});
