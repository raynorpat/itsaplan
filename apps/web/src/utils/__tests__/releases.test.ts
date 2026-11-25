import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { releaseLabel, stageOrder } from '@/utils/releases';
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
