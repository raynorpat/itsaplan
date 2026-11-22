import { auth } from '@repo/auth';
import { db, verification } from '@repo/db';
import { desc, like } from 'drizzle-orm';

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

// Registers a new user the way a person does — by magic link — and returns their
// session cookie. The link is requested through better-auth, its token read from the
// `verification` row better-auth stores it in, and the link used, which creates the
// account (through the user-create hook, so the joining rules apply) and the session.
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

  await auth.api.signInMagicLink({ body: { email, name }, headers: new Headers() });
  const [row] = await db
    .select({ token: verification.identifier })
    .from(verification)
    .where(like(verification.value, `%"email":"${email}"%`))
    .orderBy(desc(verification.createdAt))
    .limit(1);
  if (!row) throw new Error(`signUpTestUser: ${email} may not join, no magic link was stored`);

  const response = await auth.api.magicLinkVerify({
    query: { token: row.token },
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
