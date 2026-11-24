import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Label } from '@/types/team';
import { pickerLabels } from '@/utils/labels';

const label = (id: string, extra: Partial<Label> = {}): Label => ({
  id,
  teamId: 't1',
  groupId: null,
  name: id,
  color: '#000',
  retiredAt: null,
  ...extra,
});

// An issue's label picker offers the team's active labels, and lists a retired label
// only while the issue has it, so it can be taken off (as in Linear).
describe('pickerLabels', () => {
  const labels = [
    label('active'),
    label('retiredOn', { retiredAt: '2026-11-20T00:00:00Z' }),
    label('retiredOff', { retiredAt: '2026-11-20T00:00:00Z' }),
    label('workspace', { teamId: null }),
  ];

  it('lists a retired label the issue has, and not one it lacks', () => {
    assert.deepEqual(
      pickerLabels(labels, ['retiredOn']).map((l) => l.id),
      ['active', 'retiredOn'],
    );
  });

  it('offers only active team labels when nothing retired is selected', () => {
    assert.deepEqual(
      pickerLabels(labels, []).map((l) => l.id),
      ['active'],
    );
  });
});
