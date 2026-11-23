import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectHealth } from '../projectHealth';

// The health a project shows is its latest update's (Linear's Project.health). The
// update list can be newer than the project read, so a loaded latest update wins.

describe('projectHealth', () => {
  it("shows the latest update's health over the project's", () => {
    assert.equal(projectHealth({ health: 'onTrack' }, { health: 'offTrack' }), 'offTrack');
  });

  it('shows no health when the project has no updates', () => {
    assert.equal(projectHealth({ health: 'atRisk' }, null), null);
  });

  it("falls back to the project's health while the updates are not loaded", () => {
    assert.equal(projectHealth({ health: 'atRisk' }, undefined), 'atRisk');
    assert.equal(projectHealth({ health: null }, undefined), null);
  });
});
