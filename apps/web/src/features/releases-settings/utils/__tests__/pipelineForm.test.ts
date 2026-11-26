import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newStagePosition, parsePathPatterns } from '../pipelineForm';

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

describe('newStagePosition', () => {
  it('goes after the last started stage', () => {
    assert.equal(newStagePosition([1, 4, 2]), 5);
  });

  it('starts at 1 without started stages', () => {
    assert.equal(newStagePosition([]), 1);
  });
});
