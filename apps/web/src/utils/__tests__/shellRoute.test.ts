import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseShellRoute } from '@/utils/shellRoute';

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

  it('reads the team root as the board', () => {
    assert.equal(parse('/team/ENG').onBoard, true);
  });
});
