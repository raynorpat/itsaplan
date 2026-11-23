import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { QueryClient } from '@tanstack/react-query';

// Leaving or removing someone from a team addresses their TeamMembership. The lookup
// reads the members fresh: a cached list can be stale (the viewer joined after it was
// loaded), and a missing membership is an error, not a silent no-op.

process.env.NEXT_PUBLIC_API_URL = 'http://api.test';

type MembersModule = typeof import('../members.service');
let mod: MembersModule;
let qk: typeof import('@/services/queryKeys').qk;

before(async () => {
  mod = await import('../members.service');
  qk = (await import('@/services/queryKeys')).qk;
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const membership = (id: string, userId: string) => ({
  id,
  owner: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  user: { id: userId, name: userId, email: `${userId}@x.test`, avatarUrl: null },
});

function route(members: ReturnType<typeof membership>[]) {
  const deletes: unknown[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    if (/teamMembershipDelete/.test(body.query)) {
      deletes.push(body.variables.id);
      return new Response(JSON.stringify({ data: { teamMembershipDelete: { success: true } } }));
    }
    return new Response(
      JSON.stringify({
        data: {
          team: {
            id: 't1',
            memberships: { nodes: members, pageInfo: { hasNextPage: false, endCursor: null } },
          },
        },
      }),
    );
  }) as typeof fetch;
  return deletes;
}

describe('removeTeamMember', () => {
  it('finds a membership the cached list does not have yet', async () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.members('MKT'), []);
    const deletes = route([membership('m1', 'me')]);
    await mod.removeTeamMember(qc, 'MKT', 'me');
    assert.deepEqual(deletes, ['m1']);
  });

  it('throws when the user has no membership', async () => {
    const qc = new QueryClient();
    const deletes = route([membership('m1', 'someone')]);
    await assert.rejects(mod.removeTeamMember(qc, 'MKT', 'me'), /not a member/);
    assert.deepEqual(deletes, []);
  });
});
