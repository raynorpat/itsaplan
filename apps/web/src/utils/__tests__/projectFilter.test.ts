import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toProjectFilter } from '../projectFilter';

// The project list filters (team, statuses, search) as Linear's ProjectFilter.

describe('toProjectFilter', () => {
  it('is empty without filters', () => {
    assert.deepEqual(toProjectFilter({}), {});
  });

  it('maps team, statuses and search', () => {
    assert.deepEqual(
      toProjectFilter({ teamKey: 'ENG', statuses: ['completed', 'canceled'], search: '  web ' }),
      {
        accessibleTeams: { some: { key: { eq: 'ENG' } } },
        status: { type: { in: ['completed', 'canceled'] } },
        name: { containsIgnoreCase: 'web' },
      },
    );
  });

  it('leaves out a blank search and an empty status list', () => {
    assert.deepEqual(toProjectFilter({ statuses: [], search: '   ' }), {});
  });
});
