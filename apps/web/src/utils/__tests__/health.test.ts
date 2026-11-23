import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shownHealth } from '@/utils/health';

// The health a project or an initiative shows is its latest update's (Linear's
// Project.health and Initiative.health). The update list can be newer than the read
// of the project or initiative, so a loaded latest update wins.

describe('shownHealth', () => {
  it("shows the latest update's health over the item's", () => {
    assert.equal(shownHealth({ health: 'onTrack' }, { health: 'offTrack' }), 'offTrack');
  });

  it('shows no health when there are no updates', () => {
    assert.equal(shownHealth({ health: 'atRisk' }, null), null);
  });

  it("falls back to the item's health while the updates are not loaded", () => {
    assert.equal(shownHealth({ health: 'atRisk' }, undefined), 'atRisk');
    assert.equal(shownHealth({ health: null }, undefined), null);
  });
});
