import { describe, expect, it } from 'bun:test';
import { updatedFrom } from '../../event';

describe('updatedFrom', () => {
  it('holds the previous values of changed fields and the previous updatedAt', () => {
    expect(
      updatedFrom(
        { title: 'a', labelIds: ['1'], updatedAt: 't0', state: { id: 's' } },
        { title: 'b', labelIds: ['1'], updatedAt: 't1', state: { id: 'x' } },
      ),
    ).toEqual({ title: 'a', updatedAt: 't0' });
  });

  it('reports a previously unset value as null', () => {
    expect(updatedFrom({ updatedAt: 't0' }, { assigneeId: 'u', updatedAt: 't1' })).toEqual({
      assigneeId: null,
      updatedAt: 't0',
    });
  });

  it('compares arrays by value', () => {
    expect(
      updatedFrom({ labelIds: ['1'], updatedAt: 't0' }, { labelIds: ['1', '2'], updatedAt: 't1' }),
    ).toEqual({ labelIds: ['1'], updatedAt: 't0' });
  });
});
