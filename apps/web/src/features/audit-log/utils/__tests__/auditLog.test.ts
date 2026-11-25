import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDIT_RETENTIONS,
  auditEntryFilter,
  auditExportBody,
  describeEntry,
  type AuditLogFilters,
} from '../auditLog';

const entry = (type: string, metadata: Record<string, unknown> | null) => ({
  type,
  metadata,
});

describe('describeEntry', () => {
  it('names the person whose role changed', () => {
    const people = new Map([['u1', 'Milo Member']]);
    assert.equal(
      describeEntry(
        entry('userRoleChanged', {
          from: 'admin',
          to: 'member',
          entityType: 'user',
          entityId: 'u1',
        }),
        "Changed a person's workspace role",
        people,
      ),
      "Changed a person's workspace role: Milo Member, admin → member",
    );
  });

  it('writes sign-in methods and refusal reasons in words', () => {
    assert.equal(
      describeEntry(entry('login', { method: 'magicLink' }), 'Signed in'),
      'Signed in: with a magic link',
    );
    assert.equal(
      describeEntry(
        entry('loginFailed', { address: 'a@b.c', reason: 'notInvited', attempts: 2 }),
        'Refused',
      ),
      'Refused: a@b.c (not invited), 2 attempts',
    );
  });

  it('shows who was invited and as what', () => {
    assert.equal(
      describeEntry(
        entry('inviteCreated', { email: 'milo@example.com', role: 'member' }),
        'Invited',
      ),
      'Invited: milo@example.com as member',
    );
  });

  it('lists changed settings', () => {
    assert.equal(
      describeEntry(
        entry('organizationUpdated', {
          changes: { name: { from: 'Workspace', to: 'Raynor Studio' } },
        }),
        'Changed the workspace',
      ),
      'Changed the workspace: name Workspace → Raynor Studio',
    );
  });

  it('shows a change as from → to after the action', () => {
    assert.equal(
      describeEntry(entry('userRoleChanged', { from: 'member', to: 'admin' }), 'Role changed'),
      'Role changed: member → admin',
    );
  });

  it('shows a failed sign-in with its address, reason and attempts', () => {
    assert.equal(
      describeEntry(
        entry('loginFailed', {
          address: 'eve@example.com',
          reason: 'unknownAddress',
          attempts: 25,
        }),
        'Sign-in failed',
      ),
      'Sign-in failed: eve@example.com (unknown address), 25 attempts',
    );
  });

  it('does not count a single failed attempt', () => {
    assert.equal(
      describeEntry(
        entry('loginFailed', { address: '', reason: 'badLink', attempts: 1 }),
        'Sign-in failed',
      ),
      'Sign-in failed: (bad link)',
    );
  });

  it('shows an export with what was exported and its rows', () => {
    assert.equal(
      describeEntry(
        entry('dataExported', { kind: 'widget', name: 'Requests', rows: 12 }),
        'Exported',
      ),
      'Exported: widget Requests, 12 rows',
    );
  });

  it('names the affected item', () => {
    assert.equal(
      describeEntry(entry('projectDeleted', { name: 'Billing revamp' }), 'Project deleted'),
      'Project deleted: Billing revamp',
    );
  });

  it('notes entries that were not recorded', () => {
    assert.equal(
      describeEntry(entry('login', { method: 'magicLink', missedEntries: 2 }), 'Signed in'),
      'Signed in: with a magic link (2 earlier entries were not recorded)',
    );
  });

  it('falls back to the type when there is no description', () => {
    assert.equal(describeEntry(entry('logout', null), null), 'logout');
  });
});

const NONE: AuditLogFilters = { type: null, actorId: null, ip: '', from: '', to: '' };

describe('auditEntryFilter', () => {
  it('is empty without filters', () => {
    assert.equal(auditEntryFilter(NONE), undefined);
  });

  it('maps each filter to Linear’s AuditEntryFilter', () => {
    assert.deepEqual(
      auditEntryFilter({
        type: 'login',
        actorId: 'u1',
        ip: ' 10.0.0.1 ',
        from: '2026-11-01',
        to: '2026-11-25',
      }),
      {
        type: { eq: 'login' },
        actor: { id: { eq: 'u1' } },
        ip: { eq: '10.0.0.1' },
        createdAt: { gte: '2026-11-01T00:00:00.000Z', lt: '2026-11-26T00:00:00.000Z' },
      },
    );
  });
});

describe('auditExportBody', () => {
  it('sends the same filters as the POST body of the export', () => {
    assert.deepEqual(
      auditExportBody({
        type: 'login',
        actorId: null,
        ip: ' 203.0.113.7 ',
        from: '2026-11-01',
        to: '',
      }),
      { type: 'login', ip: '203.0.113.7', from: '2026-11-01T00:00:00.000Z' },
    );
  });
});

describe('describeEntry for many addresses from one IP', () => {
  it('names the number of other addresses tried', () => {
    assert.equal(
      describeEntry(
        entry('loginFailed', { scope: 'ip', reason: 'notInvited', addresses: 5, attempts: 5 }),
        'Sign-in failed',
      ),
      'Sign-in failed: 5 more addresses from this IP (not invited), 5 attempts',
    );
  });
});

describe('AUDIT_RETENTIONS', () => {
  it('starts with the 30-day default', () => {
    assert.deepEqual(
      AUDIT_RETENTIONS.map((r) => r.value),
      ['30d', '90d', '1y', '2y', '3y', 'forever'],
    );
  });
});
