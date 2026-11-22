import { auth } from '@repo/auth';

export interface TestUser {
  // The session cookie header to pass to authenticated requests, e.g.
  // authedApi(cookie) or a per-call { headers: { cookie } }.
  cookie: string;
  userId: string;
  email: string;
}

// Test users sign up on example.com, which the tests treat as an approved email
// domain unless the environment names others.
process.env.APPROVED_EMAIL_DOMAINS ??= 'example.com';

let counter = 0;

// Magic links the API logged, by address. With no mail provider configured the API
// writes each link to the log; one wrapper around console.info, installed once,
// records them (tokens are stored hashed, so the database cannot give them back) and
// still prints every line. Concurrent requests each find their own address.
const loggedLinks = new Map<string, string>();
const LINK_PREFIX = '[auth] magic link for ';
const consoleInfo = console.info.bind(console);
console.info = (...args: unknown[]) => {
  const line = args.map(String).join(' ');
  if (line.startsWith(LINK_PREFIX)) {
    const [email, url] = line.slice(LINK_PREFIX.length).split(': ');
    if (email && url) loggedLinks.set(email, url);
    return;
  }
  consoleInfo(...args);
};

// Requests a magic link for an address and returns the link's token, or null when
// none was issued (an address that may not join). The provider variables are unset
// for the request so the link is logged rather than sent.
export async function requestMagicLink(
  email: string,
  body: Record<string, unknown> = {},
): Promise<string | null> {
  const saved = { SMTP_HOST: process.env.SMTP_HOST, RESEND_API_KEY: process.env.RESEND_API_KEY };
  delete process.env.SMTP_HOST;
  delete process.env.RESEND_API_KEY;
  loggedLinks.delete(email);
  try {
    await auth.api.signInMagicLink({ body: { email, ...body }, headers: new Headers() });
  } finally {
    for (const [key, value] of Object.entries(saved))
      if (value !== undefined) process.env[key] = value;
  }
  const url = loggedLinks.get(email);
  return url ? new URL(url).searchParams.get('token') : null;
}

// Registers a new user the way a person does — by magic link — and returns their
// session cookie. The link is requested through better-auth, its token captured
// (requestMagicLink), and the link used, which creates the account (through the
// user-create hook, so the joining rules apply) and the session.
//
// The address must be allowed to join: the first user of a fresh database, an
// address with a pending invite, or an approved domain (example.com by default).
// The first user created after resetDb() is the workspace owner.
export async function signUpTestUser(
  overrides: { email?: string; name?: string } = {},
): Promise<TestUser> {
  counter += 1;
  const email = (overrides.email ?? `test-user-${counter}@example.com`).toLowerCase();
  const name = overrides.name ?? `Test User ${counter}`;

  const token = await requestMagicLink(email, { name });
  if (!token) throw new Error(`signUpTestUser: ${email} may not join, no magic link was issued`);

  const response = await auth.api.magicLinkVerify({
    query: { token },
    headers: new Headers(),
    asResponse: true,
  });
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length === 0) {
    throw new Error(
      `signUpTestUser: no Set-Cookie returned for ${email} (status ${response.status})`,
    );
  }
  // Turn each "name=value; Path=/; HttpOnly; ..." into "name=value" and join
  // them into a single Cookie header.
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');

  const body = (await response.json()) as { user?: { id?: string } };
  const userId = body.user?.id;
  if (!userId) throw new Error(`signUpTestUser: no user id returned for ${email}`);

  return { cookie, userId, email };
}
