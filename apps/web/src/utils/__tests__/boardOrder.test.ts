import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boardOrder } from '@/utils/kanban';

const e = (id: string) => ({ id, identifier: `ENG-${id}` });

describe('boardOrder', () => {
  it('reads columns left to right and cards top to bottom', () => {
    const cells = [
      { key: 'todo', issues: [e('1'), e('2')] },
      { key: 'doing', issues: [e('3')] },
    ];
    assert.deepEqual(boardOrder(cells), [e('1'), e('2'), e('3')]);
  });

  it('skips collapsed columns, whose cards are not shown', () => {
    const cells = [
      { key: 'todo', issues: [e('1')] },
      { key: 'done', issues: [e('2')] },
    ];
    assert.deepEqual(boardOrder(cells, new Set(['done'])), [e('1')]);
  });
});
