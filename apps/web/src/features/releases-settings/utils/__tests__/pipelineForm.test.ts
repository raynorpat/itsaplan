import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { movedPosition, newStagePosition, parsePathPatterns } from '../pipelineForm';

describe('parsePathPatterns', () => {
  it('splits lines and commas, trims, drops blanks and repeats', () => {
    assert.deepEqual(parsePathPatterns(' apps/web/**\n, packages/*/src/**,apps/web/** \n\n'), [
      'apps/web/**',
      'packages/*/src/**',
    ]);
  });

  it('is empty for blank text', () => {
    assert.deepEqual(parsePathPatterns('  \n '), []);
  });
});

describe('movedPosition', () => {
  const positions = [1, 2, 3];

  it('moves between the new neighbours', () => {
    assert.equal(movedPosition(positions, 0, 1), 2.5);
    assert.equal(movedPosition(positions, 2, 1), 1.5);
  });

  it('moves past the ends', () => {
    assert.equal(movedPosition(positions, 2, 0), 0);
    assert.equal(movedPosition(positions, 0, 2), 4);
  });

  it('keeps the position when nothing moves', () => {
    assert.equal(movedPosition(positions, 1, 1), 2);
  });
});

describe('newStagePosition', () => {
  it('goes after the last started stage', () => {
    assert.equal(newStagePosition([1, 4, 2]), 5);
  });

  it('starts at 1 without started stages', () => {
    assert.equal(newStagePosition([]), 1);
  });
});
