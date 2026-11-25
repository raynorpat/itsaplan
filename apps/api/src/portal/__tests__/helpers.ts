import { app } from '../../app';
import type { TestUser } from '../../__tests__/helpers/auth';
import { ORIGIN } from '../../__tests__/helpers/oauth';

// Requests for the portal tests: the visitor routes (/portal/*) and the instance
// endpoints (/api/auth/instance/*), and signing a visitor in.

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function portal(
  path: string,
  init: { body?: unknown; cookie?: string; method?: string } = {},
): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN });
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return app.handle(
    new Request(`http://localhost/portal/${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

export function instance(path: string, as: TestUser, body?: unknown): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN, cookie: as.cookie });
  if (body !== undefined) headers.set('content-type', 'application/json');
  return app.handle(
    new Request(`http://localhost/api/auth/instance/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function ok(res: Response): Promise<Json> {
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

// With no mail provider the API logs each portal sign-in link; this records the
// latest one per address and keeps every other line printed. It is the one recorder
// for every portal test file: a second console.info wrapper would hide the links from
// whichever wrapper it encloses.
export const portalLinks = new Map<string, string>();
const PREFIX = '[portal] sign-in link for ';
const previousInfo = console.info;
console.info = (...args: unknown[]) => {
  const line = args.map(String).join(' ');
  if (line.startsWith(PREFIX)) {
    const [email, url] = line.slice(PREFIX.length).split(': ');
    if (email && url) portalLinks.set(email, url);
    return;
  }
  previousInfo(...args);
};

let n = 0;

// Signs a visitor in on `board` through the sign-in routes; `email` defaults to a
// unique example.com address. Returns the session cookie and the visitor's requester.
export async function visitor(
  board: string,
  name: string,
  email = `visitor-${++n}-${Date.now()}@example.com`,
): Promise<{ cookie: string; requesterId: string; email: string }> {
  await ok(await portal('auth/link', { body: { email, board } }));
  // The link is mailed (here: logged) after the response.
  let url = portalLinks.get(email.toLowerCase());
  for (let i = 0; !url && i < 100; i++) {
    await Bun.sleep(10);
    url = portalLinks.get(email.toLowerCase());
  }
  if (!url) throw new Error(`no sign-in link for ${email}`);
  const token = new URL(url).searchParams.get('token');
  const res = await portal('auth/confirm', { body: { token, name } });
  const body = await ok(res);
  const set = res.headers.getSetCookie().find((c) => c.startsWith('portal_session='));
  return { cookie: set!.split(';')[0]!, requesterId: body.visitor.id as string, email };
}

export async function createBoard(as: TestUser, body: Json): Promise<Json> {
  return (await ok(await instance('portal/boards/create', as, body))).board as Json;
}
