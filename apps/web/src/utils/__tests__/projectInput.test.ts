import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toProjectInput } from '@/utils/projectInput';

// A project form change becomes Linear's ProjectCreateInput / ProjectUpdateInput:
// lead → leadId, status → the status's id, teams and members as id lists.

const statusIds = new Map([
  ['planned', 's-planned'],
  ['started', 's-started'],
] as const);

describe('toProjectInput', () => {
  it('maps the lead and the status', () => {
    assert.deepEqual(toProjectInput({ leadUserId: 'u1', status: 'started' }, statusIds), {
      leadId: 'u1',
      statusId: 's-started',
    });
  });

  it('clears the lead with null', () => {
    assert.deepEqual(toProjectInput({ leadUserId: null }, statusIds), { leadId: null });
  });

  it('passes teams, members, dates, labels and the other fields through', () => {
    assert.deepEqual(
      toProjectInput(
        {
          name: 'Launch',
          content: 'Body',
          teamIds: ['t1', 't2'],
          memberIds: ['u2'],
          startDate: '2026-12-01',
          targetDate: null,
          labelIds: ['l1'],
          priority: 2,
        },
        statusIds,
      ),
      {
        name: 'Launch',
        content: 'Body',
        teamIds: ['t1', 't2'],
        memberIds: ['u2'],
        startDate: '2026-12-01',
        targetDate: null,
        labelIds: ['l1'],
        priority: 2,
      },
    );
  });

  it('leaves out fields that are not set', () => {
    assert.deepEqual(toProjectInput({ name: 'X', status: undefined }, statusIds), { name: 'X' });
  });

  it('refuses a status it has no id for', () => {
    assert.throws(() => toProjectInput({ status: 'completed' }, statusIds), /completed/);
  });
});
