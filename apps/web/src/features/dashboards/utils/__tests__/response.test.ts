import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readDashboard, type DashboardSummary } from '../response';

const summary: DashboardSummary = {
  id: 'd1',
  name: 'Feedback',
  description: '',
  ownerId: null,
  ownerName: null,
  systemKey: 'feedback',
  sharedWith: 'workspace',
  teamIds: [],
  canEdit: true,
  updatedAt: '2026-11-24T00:00:00.000Z',
};

describe('readDashboard', () => {
  it('reads the dashboard the API wraps as { dashboard }', () => {
    const d = readDashboard({ dashboard: { ...summary, widgets: [] } });
    assert.equal(d.id, 'd1');
    assert.deepEqual(d.widgets, []);
  });

  it('drops widgets this app cannot render', () => {
    const d = readDashboard({ dashboard: { ...summary, widgets: [{ id: 'x', kind: 'pie' }] } });
    assert.deepEqual(d.widgets, []);
  });
});
