import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { labelCreateInput, labelGroupCreateInput, labelUpdateInput } from '../labelInput';

// Linear's labels: a group is a label with isGroup, and a label joins a group through
// parentId. A null group ungroups; an absent one leaves the group as it is.

const teamId = '00000000-0000-4000-8000-000000000001';
const groupId = '00000000-0000-4000-8000-000000000002';

describe('labelCreateInput', () => {
  it('places the label in its group', () => {
    assert.deepEqual(labelCreateInput(teamId, { name: 'Bug', color: '#f00', groupId }), {
      teamId,
      name: 'Bug',
      color: '#f00',
      parentId: groupId,
    });
  });

  it('leaves an ungrouped label without parentId', () => {
    assert.deepEqual(labelCreateInput(teamId, { name: 'Bug', groupId: null }), {
      teamId,
      name: 'Bug',
    });
  });
});

describe('labelGroupCreateInput', () => {
  it('creates a group label', () => {
    assert.deepEqual(labelGroupCreateInput(teamId, { name: 'Type', color: '#0f0' }), {
      teamId,
      name: 'Type',
      color: '#0f0',
      isGroup: true,
    });
  });
});

describe('labelUpdateInput', () => {
  it('ungroups with a null group', () => {
    assert.deepEqual(labelUpdateInput({ groupId: null }), { parentId: null });
  });

  it('sends only the fields given', () => {
    assert.deepEqual(labelUpdateInput({ color: '#00f' }), { color: '#00f' });
    assert.deepEqual(labelUpdateInput({ name: 'Bug', groupId }), {
      name: 'Bug',
      parentId: groupId,
    });
  });
});
