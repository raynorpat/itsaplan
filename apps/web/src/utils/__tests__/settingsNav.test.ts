import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Team } from '@/types/team';
import { settingsNav } from '@/utils/settingsNav';

const team = (key: string, role: Team['role'] = 'member'): Team => ({
  id: `id-${key}`,
  key,
  name: key,
  description: '',
  visibility: 'public',
  createdAt: '2026-01-01T00:00:00.000Z',
  role,
});

const keys = (items: { key: string }[]) => items.map((i) => i.key);

describe('settingsNav', () => {
  it('lists every account page for anyone', () => {
    for (const role of ['owner', 'admin', 'member', 'guest'] as const) {
      const nav = settingsNav({ workspaceRole: role, teams: [], pathname: '/settings' });
      assert.deepEqual(keys(nav.account), [
        'profile',
        'preferences',
        'notifications',
        'accounts',
        'security',
        'api-keys',
        'authorized-apps',
        'teams',
      ]);
    }
  });

  it('shows the admin-only workspace pages to owners and admins', () => {
    for (const role of ['owner', 'admin'] as const) {
      const nav = settingsNav({ workspaceRole: role, teams: [], pathname: '/settings' });
      assert.deepEqual(keys(nav.workspace), [
        'general',
        'members',
        'applications',
        'import',
        'portal',
        'mcp',
        'labels',
        'project-labels',
      ]);
    }
  });

  it('hides the admin-only workspace pages from members', () => {
    const nav = settingsNav({ workspaceRole: 'member', teams: [], pathname: '/settings' });
    assert.deepEqual(keys(nav.workspace), ['members', 'mcp', 'labels', 'project-labels']);
  });

  it('shows a guest no workspace pages, as Linear does', () => {
    const nav = settingsNav({ workspaceRole: 'guest', teams: [], pathname: '/settings' });
    assert.deepEqual(keys(nav.workspace), []);
  });

  it('lists the teams the viewer joined, and the team in the URL', () => {
    const nav = settingsNav({
      workspaceRole: 'member',
      teams: [team('ENG'), team('DES', null), team('OPS', null)],
      pathname: '/settings/teams/OPS/states',
    });
    assert.deepEqual(
      nav.teams.map((t) => t.key),
      ['ENG', 'OPS'],
    );
    assert.equal(nav.activeTeamKey, 'OPS');
  });

  it('marks the open page active', () => {
    const nav = settingsNav({
      workspaceRole: 'admin',
      teams: [],
      pathname: '/settings/workspace/members',
    });
    assert.deepEqual(
      nav.workspace.filter((i) => i.active).map((i) => i.key),
      ['members'],
    );
    assert.equal(
      nav.workspace.find((i) => i.key === 'members')?.href,
      '/settings/workspace/members',
    );
  });
});
