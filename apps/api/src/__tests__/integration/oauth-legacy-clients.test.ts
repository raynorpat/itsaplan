import { db } from '@repo/db';
import { beforeEach, describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { app } from '../../app';
import { signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { REDIRECT_URI, authorizeRequest, pkce, redirectTarget } from '../helpers/oauth';

// Every OAuth grant includes `read`. A client that registered itself before that rule
// has a scope list without `read`, and the provider refuses any request for a scope
// the client did not register, so the migration adds `read` to those lists.

const API_URL = process.env.API_URL!;
const DRIZZLE = join(import.meta.dir, '../../../../../packages/db/drizzle');

function readMigration(): string {
  const file = readdirSync(DRIZZLE).find((name) => name.endsWith('_read_on_oauth_clients.sql'));
  if (!file) throw new Error('the read-on-OAuth-clients migration is missing');
  return readFileSync(join(DRIZZLE, file), 'utf8');
}

async function registerIssuesOnly(): Promise<string> {
  const res = await app.handle(
    new Request('http://localhost/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: [REDIRECT_URI],
        client_name: 'Older MCP client',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'issues:create',
      }),
    }),
  );
  expect(res.status).toBeLessThan(300);
  return ((await res.json()) as { client_id: string }).client_id;
}

async function authorize(cookie: string, clientId: string): Promise<URL> {
  const { challenge } = pkce();
  return new URL(
    await redirectTarget(
      await authorizeRequest(cookie, {
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        state: 's',
        scope: 'issues:create',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: `${API_URL}/mcp`,
      }),
    ),
  );
}

describe('OAuth clients registered before read was always granted', () => {
  beforeEach(resetDb);

  it('can authorize again once the migration adds read to their scopes', async () => {
    const owner = await signUpTestUser();
    const clientId = await registerIssuesOnly();
    // Stored the way registration stored it before every grant included read.
    await db.execute(
      sql`UPDATE oauth_client SET scopes = array_remove(scopes, 'read') WHERE client_id = ${clientId}`,
    );

    const refused = await authorize(owner.cookie, clientId);
    expect(refused.searchParams.get('error')).toBe('invalid_scope');

    await db.execute(sql.raw(readMigration()));

    const allowed = await authorize(owner.cookie, clientId);
    expect(allowed.searchParams.get('error')).toBeNull();
  });
});
