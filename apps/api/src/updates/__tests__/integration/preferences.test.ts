import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createTeam, gqlData, signUpAs, statesByType } from '../../../__tests__/helpers/graphql';
import {
  createBoard,
  formLinks,
  instance,
  ok,
  portal,
  visitor,
  type Json,
} from '../../../portal/__tests__/helpers';
import { unsubscribeToken } from '../../unsubscribe';

// Requester update preferences: a person gets updates only after they came to the team
// themselves (portal sign-in, confirmed form) or a member turned them on; unsubscribing
// turns everything off and only the person can turn it back on.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  await createBoard(owner, { name: 'Acme', slug: 'acme', teamId: eng.team.id, access: 'public' });
  return { owner, eng };
}

const requester = async (as: TestUser, id: string) =>
  (await ok(await instance(`requester?id=${id}`, as))).requester as Json;

const myUpdates = async (cookie: string) =>
  (await ok(await portal('me/updates', { cookie }))) as Json;

// A one-click unsubscribe POST as a mail provider sends it: no cookie, no Origin.
const oneClick = (token: string) =>
  app.handle(
    new Request(
      `http://localhost/portal/unsubscribe/one-click?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      },
    ),
  );

beforeEach(async () => {
  await resetDb();
  formLinks.clear();
});

describe('who gets updates', () => {
  it('starts a requester the team created with updates off', async () => {
    const { owner } = await setup();
    const created = (
      await ok(await instance('requesters/create', owner, { name: 'Jane', email: 'jane@x.com' }))
    ).requester as Json;
    expect(created.updates).toEqual({ enabled: false, unsubscribed: false });
  });

  it('turns updates on when a person confirms a portal sign-in', async () => {
    await setup();
    const v = await visitor('acme', 'Jo');
    expect(await myUpdates(v.cookie)).toEqual({
      enabled: true,
      unsubscribed: false,
      changeEmails: true,
      summary: 'weekly',
    });
  });

  it('turns updates on when a person confirms a form submission', async () => {
    const { owner, eng } = await setup();
    const template = (
      await gqlData(
        owner,
        `mutation ($input: TemplateCreateInput!) { templateCreate(input: $input) { template { id } } }`,
        {
          input: {
            name: 'Bug report',
            type: 'issue',
            teamId: eng.team.id,
            templateData: {
              stateId: statesByType(eng).unstarted,
              formFields: [
                { id: 't', type: 'shortText', label: 'Summary', required: true, role: 'title' },
              ],
            },
          },
        },
      )
    ).templateCreate.template as { id: string };
    await ok(
      await instance('forms/settings', owner, {
        templateId: template.id,
        slug: 'bugs',
        linkEnabled: true,
      }),
    );
    await ok(
      await portal('forms/bugs', {
        body: { answers: { t: 'Broken' }, email: 'sam@example.com', name: 'Sam' },
      }),
    );
    let url = formLinks.get('sam@example.com');
    for (let i = 0; !url && i < 100; i++) {
      await Bun.sleep(10);
      url = formLinks.get('sam@example.com');
    }
    const token = new URL(url!).searchParams.get('token');
    const confirmed = await portal('forms/confirm', { body: { token } });
    await ok(confirmed);
    const cookie = confirmed.headers
      .getSetCookie()
      .find((c) => c.startsWith('portal_session='))!
      .split(';')[0]!;
    expect((await myUpdates(cookie)).enabled).toBe(true);
  });

  it('lets a member turn updates on for a person, and refuses guests', async () => {
    const { owner } = await setup();
    const jane = (await ok(await instance('requesters/create', owner, { name: 'Jane' })))
      .requester as Json;
    const member = await signUpAs('member');
    const on = await ok(
      await instance('requesters/updates', member, { requesterId: jane.id, enabled: true }),
    );
    expect(on.requester.updates).toEqual({ enabled: true, unsubscribed: false });
    const guest = await signUpAs('guest');
    const refused = await instance('requesters/updates', guest, {
      requesterId: jane.id,
      enabled: false,
    });
    expect(refused.status).toBe(403);
    expect((await requester(owner, jane.id)).updates.enabled).toBe(true);
  });
});

describe('unsubscribing', () => {
  it('turns everything off; a sign-in and the team cannot turn it on again', async () => {
    const { owner } = await setup();
    const v = await visitor('acme', 'Jo');
    const token = unsubscribeToken(v.requesterId);
    await ok(await portal('unsubscribe', { body: { token } }));
    expect(await myUpdates(v.cookie)).toMatchObject({ enabled: false, unsubscribed: true });

    await visitor('acme', 'Jo', v.email);
    expect((await myUpdates(v.cookie)).enabled).toBe(false);
    const refused = await instance('requesters/updates', owner, {
      requesterId: v.requesterId,
      enabled: true,
    });
    expect(refused.status).toBe(409);
    expect((await requester(owner, v.requesterId)).updates).toEqual({
      enabled: false,
      unsubscribed: true,
    });
  });

  it('keeps updates off after the person turns them off in the portal', async () => {
    const { owner } = await setup();
    const v = await visitor('acme', 'Jo');
    const off = await ok(
      await portal('me/updates', { cookie: v.cookie, body: { enabled: false } }),
    );
    expect(off).toMatchObject({ enabled: false, unsubscribed: true });
    await visitor('acme', 'Jo', v.email);
    expect((await myUpdates(v.cookie)).enabled).toBe(false);
    const refused = await instance('requesters/updates', owner, {
      requesterId: v.requesterId,
      enabled: true,
    });
    expect(refused.status).toBe(409);
    // The "Keep this person updated" checkbox on an existing address goes the same way.
    const again = (
      await ok(await instance('requesters/create', owner, { name: 'Jo', email: v.email }))
    ).requester as Json;
    expect(again.id).toBe(v.requesterId);
    const checkbox = await instance('requesters/updates', owner, {
      requesterId: again.id,
      enabled: true,
    });
    expect(checkbox.status).toBe(409);
    expect((await requester(owner, v.requesterId)).updates).toEqual({
      enabled: false,
      unsubscribed: true,
    });
  });

  it('keeps an unsubscribe through a merge that hands the address to another person', async () => {
    const { owner } = await setup();
    const a = await visitor('acme', 'Ann');
    await ok(await portal('unsubscribe', { body: { token: unsubscribeToken(a.requesterId) } }));
    const b = (await ok(await instance('requesters/create', owner, { name: 'Ann (call notes)' })))
      .requester as Json;
    await ok(await instance('requesters/merge', owner, { fromId: a.requesterId, intoId: b.id }));
    const kept = await requester(owner, b.id as string);
    expect(kept.email).toBe(a.email);
    expect(kept.updates).toEqual({ enabled: false, unsubscribed: true });
    const refused = await instance('requesters/updates', owner, {
      requesterId: b.id,
      enabled: true,
    });
    expect(refused.status).toBe(409);
  });

  it("unsubscribes the person kept when a merged person's old link is used", async () => {
    const { owner } = await setup();
    const a = await visitor('acme', 'Ann');
    const b = await visitor('acme', 'Bea');
    const oldLink = unsubscribeToken(a.requesterId);
    await ok(
      await instance('requesters/merge', owner, { fromId: a.requesterId, intoId: b.requesterId }),
    );
    expect((await oneClick(oldLink)).status).toBe(200);
    expect((await requester(owner, b.requesterId)).updates).toEqual({
      enabled: false,
      unsubscribed: true,
    });
  });

  it('lets the person turn updates back on from the portal', async () => {
    await setup();
    const v = await visitor('acme', 'Jo');
    await ok(await portal('unsubscribe', { body: { token: unsubscribeToken(v.requesterId) } }));
    const back = await ok(
      await portal('me/updates', { cookie: v.cookie, body: { enabled: true } }),
    );
    expect(back).toMatchObject({ enabled: true, unsubscribed: false });
  });

  it('keeps updates on and changes only the cadence when the page sends a summary choice', async () => {
    await setup();
    const v = await visitor('acme', 'Jo');
    const token = unsubscribeToken(v.requesterId);
    await ok(await portal('unsubscribe', { body: { token, summary: 'daily' } }));
    expect(await myUpdates(v.cookie)).toMatchObject({ enabled: true, summary: 'daily' });
  });

  it('accepts the one-click POST without a cookie or Origin', async () => {
    await setup();
    const v = await visitor('acme', 'Jo');
    const res = await oneClick(unsubscribeToken(v.requesterId));
    expect(res.status).toBe(200);
    expect(await myUpdates(v.cookie)).toMatchObject({ enabled: false, unsubscribed: true });
  });

  it('refuses a forged token and never changes another person', async () => {
    await setup();
    const a = await visitor('acme', 'Ann');
    const b = await visitor('acme', 'Bob');
    const forged = `${b.requesterId}.${unsubscribeToken(a.requesterId).split('.')[1]}`;
    expect((await portal(`unsubscribe?token=${forged}`)).status).toBe(400);
    expect((await portal('unsubscribe', { body: { token: forged } })).status).toBe(400);
    expect((await oneClick(forged)).status).toBe(400);
    expect((await oneClick('nonsense')).status).toBe(400);
    await ok(await portal('unsubscribe', { body: { token: unsubscribeToken(a.requesterId) } }));
    expect((await myUpdates(b.cookie)).enabled).toBe(true);
    expect((await myUpdates(a.cookie)).enabled).toBe(false);
  });

  it('signs links with a key of their own, not the raw instance secret', async () => {
    await setup();
    const v = await visitor('acme', 'Jo');
    const raw = createHmac('sha256', process.env.BETTER_AUTH_SECRET!)
      .update(`unsubscribe:${v.requesterId}`)
      .digest('base64url');
    expect((await oneClick(`${v.requesterId}.${raw}`)).status).toBe(400);
    expect((await myUpdates(v.cookie)).enabled).toBe(true);
  });

  it('shows a masked address on the unsubscribe page', async () => {
    await setup();
    const v = await visitor('acme', 'Jo', 'jordan@acme.com');
    const page = await ok(await portal(`unsubscribe?token=${unsubscribeToken(v.requesterId)}`));
    expect(page.email).toBe('j***@acme.com');
    expect(page.prefs).toMatchObject({ enabled: true, summary: 'weekly' });
  });
});

describe("a person's own preferences", () => {
  it('changes change emails and the summary cadence, and refuses unknown values', async () => {
    await setup();
    const v = await visitor('acme', 'Jo');
    const changed = await ok(
      await portal('me/updates', {
        cookie: v.cookie,
        body: { changeEmails: false, summary: 'off' },
      }),
    );
    expect(changed).toMatchObject({ enabled: true, changeEmails: false, summary: 'off' });
    const bad = await portal('me/updates', { cookie: v.cookie, body: { summary: 'hourly' } });
    expect(bad.status).toBe(400);
    expect((await portal('me/updates')).status).toBe(401);
  });
});
