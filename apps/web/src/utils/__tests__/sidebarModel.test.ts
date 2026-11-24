import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Team } from '@/types/team';
import { sidebarModel } from '@/utils/sidebarModel';

const team = (key: string, extra: Partial<Team> = {}): Team => ({
  id: `id-${key}`,
  key,
  name: key,
  description: '',
  visibility: 'public',
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'member',
  ...extra,
});

describe('sidebarModel', () => {
  it('lists Inbox and My issues first, then the workspace section', () => {
    const model = sidebarModel({ workspaceRole: 'member', teams: [] });
    assert.deepEqual(
      model.top.map((i) => i.key),
      ['inbox', 'my-issues'],
    );
    assert.deepEqual(
      model.workspace.map((i) => i.key),
      ['projects', 'views', 'initiatives'],
    );
  });

  it('hides Initiatives from guests', () => {
    const model = sidebarModel({ workspaceRole: 'guest', teams: [team('ENG')] });
    assert.deepEqual(
      model.workspace.map((i) => i.key),
      ['projects', 'views'],
    );
  });

  it('gives a section only to teams the viewer joined', () => {
    const model = sidebarModel({
      workspaceRole: 'admin',
      teams: [team('ENG'), team('OPS', { role: null }), team('DES', { role: 'owner' })],
    });
    assert.deepEqual(
      model.teams.map((s) => s.team.key),
      ['ENG', 'DES'],
    );
  });

  it('shows Cycles only for a team with cycles on', () => {
    const model = sidebarModel({
      workspaceRole: 'member',
      teams: [team('ENG', { cyclesEnabled: true }), team('DES')],
    });
    const [eng, des] = model.teams;
    assert.deepEqual(
      eng.items.map((i) => i.key),
      ['issues', 'cycles', 'projects', 'views'],
    );
    assert.deepEqual(
      des.items.map((i) => i.key),
      ['issues', 'projects', 'views'],
    );
    assert.equal(eng.items[0].label, 'Issues');
    assert.equal(eng.items[0].href, '/team/ENG');
    assert.equal(eng.items[1].href, '/team/ENG/cycles');
    assert.equal(eng.items[2].href, '/projects?team=ENG');
    assert.equal(eng.items[3].label, 'Views');
    assert.equal(eng.items[3].href, '/team/ENG/views');
  });

  it('links the workspace Views page', () => {
    const model = sidebarModel({ workspaceRole: 'member', teams: [] });
    assert.equal(model.workspace.find((i) => i.key === 'views')?.href, '/views');
  });
});
