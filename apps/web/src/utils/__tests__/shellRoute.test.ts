import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseShellRoute, shellBodyState } from '@/utils/shellRoute';

const parse = (pathname: string, team: string | null = null) =>
  parseShellRoute(pathname, team, pathname.startsWith('/team/') ? pathname.split('/')[2]! : null);

describe('parseShellRoute', () => {
  it('reads the inbox as a workspace route, never a team route', () => {
    const r = parse('/inbox');
    assert.equal(r.workspace, true);
    assert.equal(r.teamKey, null);
    assert.equal(r.onBoard, false);
  });

  it('reads My issues as a workspace route', () => {
    const r = parse('/my-issues/created');
    assert.equal(r.workspace, true);
    assert.equal(r.sub, 'my-issues');
  });

  it('keeps ?team= on the projects area', () => {
    const r = parse('/projects/abc', 'ENG');
    assert.deepEqual([r.workspace, r.teamKey, r.routeProjectId], [true, 'ENG', 'abc']);
  });

  it('reads a team issue route', () => {
    const r = parse('/team/ENG/issue/12');
    assert.deepEqual([r.workspace, r.teamKey, r.routeIssueSeq], [false, 'ENG', 12]);
  });

  it('reads the account and workspace settings as a workspace route', () => {
    const r = parse('/settings/workspace/members');
    assert.deepEqual([r.workspace, r.sub, r.teamKey], [true, 'settings', null]);
  });

  it("reads a team's settings with the team from the path", () => {
    const r = parse('/settings/teams/ENG/states');
    assert.deepEqual([r.workspace, r.sub, r.teamKey], [false, 'settings', 'ENG']);
  });

  it('reads the team root as the board', () => {
    assert.equal(parse('/team/ENG').onBoard, true);
  });

  it('needs no team on the inbox, My issues and the account and workspace settings', () => {
    for (const path of [
      '/inbox',
      '/my-issues',
      '/my-issues/created',
      '/settings/account/profile',
      '/settings/workspace/members',
    ])
      assert.equal(parse(path).needsTeam, false, path);
  });

  it("needs a team on team routes, a team's settings, Projects and Initiatives", () => {
    for (const path of [
      '/team/ENG',
      '/team/ENG/issue/3',
      '/settings/teams/ENG/states',
      '/projects',
      '/initiatives/abc',
    ])
      assert.equal(parse(path).needsTeam, true, path);
  });
});

describe('shellBodyState', () => {
  const base = {
    forbidden: false,
    needsTeam: true,
    hasTeam: false,
    hasError: false,
    teamsLoaded: true,
    teamCount: 0,
  };

  it('renders the page without a team where none is needed', () => {
    assert.equal(shellBodyState({ ...base, needsTeam: false }), 'page');
    assert.equal(shellBodyState({ ...base, needsTeam: false, teamsLoaded: false }), 'page');
  });

  it('keeps the team gate on team routes', () => {
    assert.equal(shellBodyState(base), 'no-teams');
    assert.equal(shellBodyState({ ...base, teamsLoaded: false }), 'loading');
    assert.equal(shellBodyState({ ...base, hasError: true }), 'unavailable');
    assert.equal(shellBodyState({ ...base, forbidden: true }), 'forbidden');
    assert.equal(shellBodyState({ ...base, hasTeam: true }), 'page');
  });
});
