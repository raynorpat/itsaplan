import { beforeEach, describe, expect, it } from 'bun:test';
import { normaliseScopes } from '@repo/auth';
import { app } from '../../app';
import { signUpTestUser, type TestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { createTeam, gqlData } from '../helpers/graphql';
import { callTool, mcp } from '../helpers/mcp';
import {
  REDIRECT_URI,
  authPost,
  authorizeRequest,
  clientCredentials,
  createClient,
  install,
  obtainTokens,
  pkce,
  redirectTarget,
  tokenRequest,
} from '../helpers/oauth';

// MCP sign-in with OAuth (the MCP authorization spec, as Linear's MCP server does it):
// the server describes itself as a protected resource, a 401 points the client at
// that description, a client registers itself, the person consents, and the tools run
// as that person within the token's scopes, through GraphQL. API keys keep working.

const API_URL = process.env.API_URL!;
const ISSUES = 'query($id: String!) { team(id: $id) { issues { nodes { title } } } }';

// Registers a public client the way an MCP client does (with the scopes it will ask
// for, or none for the defaults), then runs the browser part
// (authorize with PKCE and the resource, consent) and the token exchange.
async function mcpClientToken(person: TestUser, scope?: string): Promise<string> {
  const reg = await app.handle(
    new Request('http://localhost/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: [REDIRECT_URI],
        client_name: 'Some MCP client',
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        // A client asks at authorize for no more than it registered with.
        ...(scope ? { scope: normaliseScopes(scope).join(' ') } : {}),
      }),
    }),
  );
  expect(reg.status).toBeLessThan(300);
  const { client_id } = (await reg.json()) as { client_id: string };
  const { verifier, challenge } = pkce();
  const params: Record<string, string> = {
    client_id,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    state: 's',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${API_URL}/mcp`,
    ...(scope ? { scope } : {}),
  };
  let target = new URL(await redirectTarget(await authorizeRequest(person.cookie, params)));
  if (!target.searchParams.get('code')) {
    const consent = await authPost('/oauth2/consent', person.cookie, {
      accept: true,
      oauth_query: target.search.slice(1),
    });
    target = new URL(await redirectTarget(consent));
  }
  const res = await tokenRequest({
    grant_type: 'authorization_code',
    code: target.searchParams.get('code')!,
    redirect_uri: REDIRECT_URI,
    client_id,
    code_verifier: verifier,
    resource: `${API_URL}/mcp`,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function titles(owner: TestUser, key: string): Promise<string[]> {
  const data = await gqlData(owner, ISSUES, { id: key });
  return data.team.issues.nodes.map((n: { title: string }) => n.title);
}

describe('MCP sign-in with OAuth', () => {
  let owner: TestUser;

  beforeEach(async () => {
    await resetDb();
    owner = await signUpTestUser({ name: 'Owner' });
    await createTeam(owner, { key: 'MKT', name: 'Marketing' });
    await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  });

  it('describes itself as a protected resource and points a 401 at it', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const res = await app.handle(new Request(`http://localhost${path}`));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        resource: `${API_URL}/mcp`,
        authorization_servers: [API_URL],
        bearer_methods_supported: ['header'],
      });
      // An MCP client may only ask for these when it registers itself.
      expect((body.scopes_supported as string[]).sort()).toEqual(
        ['comments:create', 'issues:create', 'read', 'write'].sort(),
      );
    }
    const res = await mcp(null, 'tools/list');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${API_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
    const bad = await mcp('itpo_notatoken', 'tools/list');
    expect(bad.status).toBe(401);
    expect(bad.headers.get('www-authenticate')).toContain('error="invalid_token"');

    // The read-only endpoint is its own protected resource.
    const meta = await app.handle(
      new Request('http://localhost/.well-known/oauth-protected-resource/mcp/readonly'),
    );
    expect(meta.status).toBe(200);
    expect(((await meta.json()) as { resource: string }).resource).toBe(`${API_URL}/mcp/readonly`);
    const readonly = await mcp(null, 'tools/list', {}, '/mcp/readonly');
    expect(readonly.status).toBe(401);
    expect(readonly.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${API_URL}/.well-known/oauth-protected-resource/mcp/readonly"`,
    );
  });

  it('runs tools as the person who consented, with read and write by default', async () => {
    const token = await mcpClientToken(owner);
    const list = await mcp(token, 'tools/list');
    expect((list.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
    const teams = await callTool(token, 'list_teams');
    expect(teams.isError).toBeFalsy();
    expect(teams.content[0]!.text).toContain('MKT');
    const created = await callTool(token, 'create_issue', { team: 'MKT', title: 'Via MCP' });
    expect(created.isError).toBeFalsy();
    expect(await titles(owner, 'MKT')).toContain('Via MCP');
  });

  it('refuses a tool the token has no scope for', async () => {
    const readOnly = await mcpClientToken(owner, 'read');
    expect((await callTool(readOnly, 'list_teams')).isError).toBeFalsy();
    const refused = await callTool(readOnly, 'create_issue', { team: 'MKT', title: 'Nope' });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain('write');
    expect(await titles(owner, 'MKT')).not.toContain('Nope');

    const issuesOnly = await mcpClientToken(owner, 'issues:create');
    const created = await callTool(issuesOnly, 'create_issue', { team: 'MKT', title: 'Made' });
    expect(created.isError).toBeFalsy();
    const issueId = (JSON.parse(created.content[0]!.text) as { id: string }).id;
    expect(
      (await callTool(issuesOnly, 'update_issue', { issueId, title: 'Changed' })).isError,
    ).toBe(true);
    expect((await callTool(issuesOnly, 'create_comment', { issueId, body: 'Hi' })).isError).toBe(
      true,
    );
    // `read` is part of every grant (Linear), so the narrow token can still read.
    expect((await callTool(issuesOnly, 'list_teams')).isError).toBeFalsy();

    // `write` includes reading, as on GraphQL.
    const writeOnly = await mcpClientToken(owner, 'write');
    expect((await callTool(writeOnly, 'list_teams')).isError).toBeFalsy();

    const commentsOnly = await mcpClientToken(owner, 'comments:create');
    expect(
      (await callTool(commentsOnly, 'create_comment', { issueId, body: 'Hi' })).isError,
    ).toBeFalsy();
  });

  it('applies the token scopes GraphQL applies, admin included', async () => {
    // A token without `admin` reads an owner as a member, as on GraphQL: with workspace
    // labels limited to admins, only the token with `admin` may create one.
    await gqlData(
      owner,
      'mutation { organizationUpdate(input: { securitySettings: { labelManagementRole: admin } }) { success } }',
    );
    const client = await createClient(owner.cookie);
    const plain = await obtainTokens(owner.cookie, client, 'read,write');
    const refused = await callTool(plain.access_token, 'create_issue_label', { name: 'Plain' });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain('You cannot manage workspace labels');

    const admin = await obtainTokens(owner.cookie, client, 'read,write,admin');
    const made = await callTool(admin.access_token, 'create_issue_label', { name: 'Admin' });
    expect(made.isError).toBeFalsy();
  });

  it('runs an app token as the app user, within its teams', async () => {
    const client = await createClient(owner.cookie, { clientCredentials: true });
    const mkt = await gqlData(owner, 'query { team(id: "MKT") { id } }');
    await install(owner.cookie, client, {
      teamIds: [mkt.team.id],
      publicTeams: false,
    });
    const m2m = (await (await clientCredentials(client)).json()) as { access_token: string };
    const teams = await callTool(m2m.access_token, 'list_teams');
    expect(teams.content[0]!.text).toContain('MKT');
    expect(teams.content[0]!.text).not.toContain('ENG');
  });
});
