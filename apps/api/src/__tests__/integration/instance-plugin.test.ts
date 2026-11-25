import { beforeEach, describe, expect, it } from 'bun:test';
import { provideInstanceHandlers, signInOptions } from '@repo/auth';
import { app } from '../../app';
import { registerInstanceHandlers } from '../../instance/handlers';
import { signUpTestUser, type TestUser } from '../helpers/auth';
import { addMember, createTeam, signUpAs, teamView } from '../helpers/graphql';
import { resetDb } from '../helpers/db';
import { getStorageSettings } from '../../settings/storage';
import { getAppVersion } from '../../settings/version';
import { oauthAppsHandlers } from '../../oauth/apps';
import { importsHandlers } from '../../imports/handlers';
import { requestersHandlers } from '../../feedback/handlers';
import { formsHandlers } from '../../forms/admin';
import { aiHandlers } from '../../updates/ai';
import { dashboardsHandlers } from '../../dashboards/handlers';
import { customersHandlers } from '../../customers/handlers';
import { favoritesHandlers } from '../../favorites/handlers';
import { portalHandlers } from '../../portal/admin';
import { workflowsHandlers } from '../../workflows/handlers';
import { accountEmailsHandlers } from '../../accounts/handlers';

// The instance endpoints served by the better-auth plugin under /api/auth/instance/*:
// sign-in options (public), the app version and upload limits (signed in), and the
// team owner change (team managers only).

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
  const teamId = (await createTeam(owner, { key: 'MKT', name: 'Marketing' })).team.id;
  const member = await signUpAs('member', { name: 'Ann' });
  await addMember(owner, teamId, member.userId);
  return { owner, asOwner: owner, teamId, member };
}

const roleOf = async (asOwner: TestUser, userId: string) => {
  const found = (await teamView(asOwner, 'MKT')).members.find((m) => m.userId === userId);
  return found ? (found.owner ? 'owner' : 'member') : undefined;
};

describe('instance plugin', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('serves the sign-in options without a session', async () => {
    const res = await call('sign-in-options');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(await signInOptions());
  });

  it('serves the version and upload limits to a signed-in user only', async () => {
    expect((await call('version')).status).toBe(401);
    expect((await call('upload-limits')).status).toBe(401);

    const user = await signUpTestUser();
    const version = await call('version', { cookie: user.cookie });
    expect(version.status).toBe(200);
    expect(await version.json()).toEqual({ version: getAppVersion() });
    const limits = await call('upload-limits', { cookie: user.cookie });
    expect(limits.status).toBe(200);
    expect(await limits.json()).toEqual(JSON.parse(JSON.stringify(await getStorageSettings())));
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
    const other = await signUpAs('member', { name: 'Ben' });
    await addMember(owner, teamId, other.userId);

    // A plain member of a team that has an owner does not manage it.
    const byMember = await call('team-owner', {
      cookie: member.cookie,
      body: { teamId, userId: other.userId, owner: true },
    });
    expect(byMember.status).toBe(403);

    const guest = await signUpAs('guest', { name: 'Gus' });
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

    const stranger = await signUpAs('member', { name: 'Sam' });
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
      oauthApps: oauthAppsHandlers,
      agentSessionStop: async () => ({ success: true }),
      workflows: workflowsHandlers,
      accountEmails: accountEmailsHandlers,
      imports: importsHandlers,
      requesters: requestersHandlers,
      portal: portalHandlers,
      forms: formsHandlers,
      ai: aiHandlers,
      dashboards: dashboardsHandlers,
      customers: customersHandlers,
      favorites: favoritesHandlers,
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
