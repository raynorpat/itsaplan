import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProjectRelationItem, RelationEnd } from '@/utils/projectRelations';
import { dependencyText } from '../dependencyText';

const end = (projectId: string, over: Partial<RelationEnd> = {}): RelationEnd => ({
  projectId,
  projectName: projectId,
  startDate: null,
  targetDate: null,
  anchorType: 'end',
  milestone: null,
  ...over,
});

describe('dependencyText', () => {
  it('describes a project this one is blocked by from the other side first', () => {
    const r: ProjectRelationItem = {
      id: 'r',
      from: end('a', { anchorType: 'end' }),
      to: end('b', { anchorType: 'start' }),
    };
    assert.equal(dependencyText(r, 'b'), "Its end → this project's start");
  });

  it('describes a project this one blocks from this side first', () => {
    const r: ProjectRelationItem = {
      id: 'r',
      from: end('a', {
        anchorType: 'milestone',
        milestone: { id: 'm', name: 'API ready', targetDate: null },
      }),
      to: end('b', { anchorType: 'start' }),
    };
    assert.equal(dependencyText(r, 'a'), "This project's milestone API ready → its start");
  });
});
