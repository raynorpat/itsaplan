import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sortForField } from '@/utils/viewTypes';

describe('sortForField', () => {
  it('starts Requests, Created and Updated with the highest or newest first', () => {
    for (const field of ['requests', 'created', 'updated'] as const)
      assert.deepEqual(sortForField(field), { field, dir: 'desc' });
  });
  it('starts the other fields ascending', () => {
    for (const field of ['title', 'priority', 'dueDate', 'manual'] as const)
      assert.deepEqual(sortForField(field), { field, dir: 'asc' });
  });
});
