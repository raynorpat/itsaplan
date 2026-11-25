import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDIT_RETENTIONS,
  auditEntryFilter,
  auditExportQuery,
  describeEntry,
  type AuditLogFilters,
} from '../auditLog';

const entry = (type: string, metadata: Record<string, unknown> | null) => ({
  type,
  metadata,
});

describe('describeEntry', () => {
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
      'Sign-in failed: eve@example.com (unknownAddress), 25 attempts',
    );
  });

  it('does not count a single failed attempt', () => {
    assert.equal(
      describeEntry(
        entry('loginFailed', { address: '', reason: 'badLink', attempts: 1 }),
        'Sign-in failed',
      ),
      'Sign-in failed: (badLink)',
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
      'Signed in: magicLink (2 earlier entries were not recorded)',
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

describe('auditExportQuery', () => {
  it('builds the export endpoint query from the same filters', () => {
    assert.equal(
      auditExportQuery({ type: 'login', actorId: null, ip: '', from: '2026-11-01', to: '' }),
      'type=login&from=2026-11-01T00%3A00%3A00.000Z',
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
