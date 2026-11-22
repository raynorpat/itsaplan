import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

// gqlRequest: posts the document with the session cookie, returns `data`, and turns
// GraphQL errors into the web's ApiError with the status REST would have used.

process.env.NEXT_PUBLIC_API_URL = 'http://api.test';

type GraphqlModule = typeof import('../graphql');
type ApiModule = typeof import('../api');
let mod: GraphqlModule;
let ApiError: ApiModule['ApiError'];

before(async () => {
  mod = await import('../graphql');
  ({ ApiError } = await import('../api'));
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let calls: [string, RequestInit][] = [];
function respond(body: unknown, status = 200) {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

const viewerDoc = () => mod.graphql(`query Viewer { viewer { id name } }`);

describe('gqlRequest', () => {
  it('posts with credentials and returns data', async () => {
    respond({ data: { viewer: { id: 'u1', name: 'Ann' } } });
    const data = await mod.gqlRequest(viewerDoc());
    assert.equal(data.viewer.id, 'u1');
    const [url, init] = calls[0]!;
    assert.equal(url, 'http://api.test/graphql');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'include');
    assert.match(String(JSON.parse(String(init.body)).query), /viewer/);
  });

  it('maps error codes', async () => {
    const cases: [string, number][] = [
      ['INVALID_INPUT', 400],
      ['FORBIDDEN', 403],
      ['ENTITY_NOT_FOUND', 404],
      ['CONFLICT', 409],
      ['AUTHENTICATION_ERROR', 401],
      ['INTERNAL', 500],
    ];
    for (const [code, status] of cases) {
      respond({ data: null, errors: [{ message: `msg ${code}`, extensions: { code } }] });
      const err = await mod.gqlRequest(viewerDoc()).catch((e: unknown) => e);
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, status);
      assert.equal(err.message, `msg ${code}`);
    }
  });

  it('treats an HTTP 401 as no session', async () => {
    respond({ errors: [{ message: 'Not signed in' }] }, 401);
    const err = await mod.gqlRequest(viewerDoc()).catch((e: unknown) => e);
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 401);
  });
});
