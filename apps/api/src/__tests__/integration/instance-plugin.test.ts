import { beforeEach, describe, expect, it } from 'bun:test';
import { provideInstanceHandlers } from '@repo/auth';
import { app } from '../../app';
import { registerInstanceHandlers } from '../../instance/handlers';
import { authedApi } from '../helpers/app';
import { signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { signUpWithRole } from '../helpers/roles';

// The instance endpoints served by the better-auth plugin under /api/auth/instance/*:
// sign-in options (public), the app version and upload limits (signed in), and the
// team owner change (team managers, same rules as the REST member role route).

const ORIGIN = (process.env.APP_URL ?? '').split(',')[0]!.trim();

function call(path: string, init: { cookie?: string; body?: unknown } = {}) {
  const headers = new Headers({ origin: ORIGIN });
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return app.handle(
    new Request(`http://localhost/api/auth/instance/${path}`, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

async function setupTeam() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const teamId = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.team.id;
  const member = await signUpWithRole('member', { name: 'Ann' });
  await asOwner.teams({ teamKey: 'MKT' }).members.post({ userId: member.userId, owner: false });
  return { owner, asOwner, teamId, member };
}

const roleOf = async (asOwner: ReturnType<typeof authedApi>, userId: string) =>
  (await asOwner.teams({ teamKey: 'MKT' }).members.get()).data?.find((m) => m.userId === userId)
    ?.role;

describe('instance plugin', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('serves the sign-in options without a session, as /auth-config does', async () => {
    const res = await call('sign-in-options');
    expect(res.status).toBe(200);
    const rest = await app.handle(new Request('http://localhost/auth-config'));
    expect(await res.json()).toEqual(await rest.json());
  });

  it('serves the version and upload limits to a signed-in user only', async () => {
    expect((await call('version')).status).toBe(401);
    expect((await call('upload-limits')).status).toBe(401);

    const user = await signUpTestUser();
    const version = await call('version', { cookie: user.cookie });
    expect(version.status).toBe(200);
    expect(await version.json()).toEqual(
      (await authedApi(user.cookie).settings.version.get()).data as object,
    );
    const limits = await call('upload-limits', { cookie: user.cookie });
    expect(limits.status).toBe(200);
    expect(await limits.json()).toEqual(
      (await authedApi(user.cookie).settings.storage.get()).data as object,
    );
  });

  it('lets a team manager make a member a team owner and back', async () => {
    const { owner, asOwner, teamId, member } = await setupTeam();
    const made = await call('team-owner', {
      cookie: owner.cookie,
      body: { teamId, userId: member.userId, owner: true },
    });
    expect(made.status).toBe(200);
    expect(await made.json()).toEqual({ teamId, userId: member.userId, owner: true });
    expect(await roleOf(asOwner, member.userId)).toBe('owner');

    const back = await call('team-owner', {
      cookie: owner.cookie,
      body: { teamId, userId: member.userId, owner: false },
    });
    expect(back.status).toBe(200);
    expect(await roleOf(asOwner, member.userId)).toBe('member');
  });

  it('refuses the owner change to a non-manager, a guest, oneself and without a session', async () => {
    const { owner, asOwner, teamId, member } = await setupTeam();
    const other = await signUpWithRole('member', { name: 'Ben' });
    await asOwner.teams({ teamKey: 'MKT' }).members.post({ userId: other.userId, owner: false });

    // A plain member of a team that has an owner does not manage it.
    const byMember = await call('team-owner', {
      cookie: member.cookie,
      body: { teamId, userId: other.userId, owner: true },
    });
    expect(byMember.status).toBe(403);

    const guest = await signUpWithRole('guest', { name: 'Gus' });
    const byGuest = await call('team-owner', {
      cookie: guest.cookie,
      body: { teamId, userId: other.userId, owner: true },
    });
    expect(byGuest.status).toBe(404);

    const self = await call('team-owner', {
      cookie: owner.cookie,
      body: { teamId, userId: owner.userId, owner: false },
    });
    expect(self.status).toBe(400);

    const stranger = await signUpWithRole('member', { name: 'Sam' });
    const notMember = await call('team-owner', {
      cookie: owner.cookie,
      body: { teamId, userId: stranger.userId, owner: true },
    });
    expect(notMember.status).toBe(404);

    const anonymous = await call('team-owner', {
      body: { teamId, userId: other.userId, owner: true },
    });
    expect(anonymous.status).toBe(401);

    const badId = await call('team-owner', {
      cookie: owner.cookie,
      body: { teamId: 'nope', userId: other.userId, owner: true },
    });
    expect(badId.status).toBe(400);

    expect(await roleOf(asOwner, other.userId)).toBe('member');
  });
});

describe('instance plugin errors and origin checks', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("answers a handler's HTTP status as is, beyond the common ones", async () => {
    const tooLarge = Object.assign(new Error('Too large'), { status: 413 });
    provideInstanceHandlers({
      version: async () => {
        throw tooLarge;
      },
      uploadLimits: async () => ({}),
      setTeamOwner: async () => {
        throw tooLarge;
      },
    });
    try {
      const res = await call('version');
      expect(res.status).toBe(413);
      expect(((await res.json()) as { message: string }).message).toBe('Too large');
    } finally {
      registerInstanceHandlers();
    }
  });

  it('refuses a cookie-authenticated owner change from a foreign origin or none', async () => {
    const { owner, teamId, member } = await setupTeam();
    const body = JSON.stringify({ teamId, userId: member.userId, owner: true });
    for (const origin of ['https://evil.example', null]) {
      const headers = new Headers({ cookie: owner.cookie, 'content-type': 'application/json' });
      if (origin) headers.set('origin', origin);
      const res = await app.handle(
        new Request('http://localhost/api/auth/instance/team-owner', {
          method: 'POST',
          headers,
          body,
        }),
      );
      expect(res.status).toBe(403);
    }
  });
});
