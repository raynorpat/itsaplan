import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sliceColor } from '../palette';

describe('sliceColor', () => {
  it('gives each priority, and no priority, its own colour, stable by key', () => {
    const colours = ['1', '2', '3', '4', '0'].map((k, i) => sliceColor('priority', k, i));
    assert.equal(new Set(colours).size, 5);
    assert.equal(sliceColor('priority', '1', 4), sliceColor('priority', '1', 0));
  });
  it('mutes the none slice and cycles a palette for the rest', () => {
    assert.equal(sliceColor('assignee', 'none', 0), sliceColor('label', 'none', 3));
    assert.notEqual(sliceColor('assignee', 'a', 0), sliceColor('assignee', 'b', 1));
  });
  it("uses a status's own colour", () => {
    const states = new Map([
      ['s1', { name: 'Todo', type: 'unstarted', position: 1, color: '#123456' }],
    ]);
    assert.equal(sliceColor('status', 's1', 0, states), '#123456');
  });
});
