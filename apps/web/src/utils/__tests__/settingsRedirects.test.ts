import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { SETTINGS_REDIRECTS } from '@/utils/settingsRedirects';

// Applies the redirect table the way Next matches `:param` segments, first match wins.
function resolve(path: string): string | null {
  const segs = path.split('/').filter(Boolean);
  for (const { source, destination } of SETTINGS_REDIRECTS) {
    const pattern = source.split('/').filter(Boolean);
    if (pattern.length !== segs.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((p, i) => {
      if (p.startsWith(':')) {
        params[p.slice(1)] = segs[i]!;
        return true;
      }
      return p === segs[i];
    });
    if (ok) return destination.replace(/:([A-Za-z]+)/g, (_, k: string) => params[k]!);
  }
  return null;
}

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

// The page file a settings URL renders, with team keys as the [teamKey] segment.
function pageFor(path: string): string {
  const segs = path.split('/').filter(Boolean);
  const mapped = segs.map((s, i) => (segs[i - 1] === 'teams' ? '[teamKey]' : s));
  return join(APP, ...mapped, 'page.tsx');
}

const CASES: [string, string][] = [
  ['/settings', '/settings/account/profile'],
  ['/account', '/settings/account/profile'],
  ['/account/profile', '/settings/account/profile'],
  ['/account/preferences', '/settings/account/preferences'],
  ['/account/accounts', '/settings/account/accounts'],
  ['/account/security', '/settings/account/security'],
  ['/account/api-keys', '/settings/account/api-keys'],
  ['/account/authorized-apps', '/settings/account/authorized-apps'],
  ['/account/teams', '/settings/account/teams'],
  ['/team/ENG/notifications', '/settings/account/notifications'],
  ['/workspace/settings', '/settings/workspace/general'],
  ['/workspace/members', '/settings/workspace/members'],
  ['/workspace/applications', '/settings/workspace/applications'],
  ['/projects/settings/labels', '/settings/workspace/project-labels'],
  ['/team/ENG/mcp', '/settings/workspace/mcp'],
  ['/team/ENG/members', '/settings/teams/ENG/members'],
  ['/team/ENG/settings', '/settings/teams/ENG'],
  ['/team/ENG/settings/general', '/settings/teams/ENG/general'],
  ['/team/ENG/settings/states', '/settings/teams/ENG/states'],
  ['/team/ENG/settings/labels', '/settings/teams/ENG/labels'],
  ['/team/ENG/settings/cycles', '/settings/teams/ENG/cycles'],
  ['/team/ENG/settings/archive', '/settings/teams/ENG/archive'],
  ['/team/ENG/settings/webhooks', '/settings/teams/ENG/webhooks'],
];

describe('settings redirects', () => {
  for (const [from, to] of CASES) {
    it(`sends ${from} to ${to}`, () => {
      assert.equal(resolve(from), to);
    });
  }

  it('sends every old address to a page that exists', () => {
    for (const [, to] of CASES) {
      if (to === '/settings/account/profile' || to.split('/').length > 3) {
        assert.ok(existsSync(pageFor(to)), `no page for ${to}`);
      }
    }
  });

  it('leaves the old settings pages removed', () => {
    for (const old of ['account/profile', 'workspace/settings', 'projects/settings/labels']) {
      assert.ok(!existsSync(join(APP, old, 'page.tsx')), `${old} still exists`);
    }
    assert.ok(!existsSync(join(APP, 'team', '[teamKey]', 'settings')), 'team settings still exist');
  });
});
