import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

// The avatar the Linear way: fileUpload returns a signed URL, the bytes go there in a
// PUT, then userUpdate sets avatarUrl to the stored file. Removing sets it to null.

process.env.NEXT_PUBLIC_API_URL = 'http://api.test';

type ProfileModule = typeof import('../profile.service');
let mod: ProfileModule;

before(async () => {
  mod = await import('../profile.service');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: string; method: string; query?: string; variables?: Record<string, unknown> };
let calls: Call[] = [];

function route(handlers: { fileUpload?: () => unknown; put?: () => Response }) {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith('/graphql')) {
      const body = JSON.parse(String(init.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      calls.push({ url, method: 'POST', query: body.query, variables: body.variables });
      if (/fileUpload/.test(body.query))
        return new Response(JSON.stringify(handlers.fileUpload?.()), { status: 200 });
      return new Response(
        JSON.stringify({ data: { userUpdate: { success: true, user: { id: 'me' } } } }),
        { status: 200 },
      );
    }
    calls.push({ url, method: String(init.method) });
    return handlers.put?.() ?? new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
}

const signed = () => ({
  data: {
    fileUpload: {
      success: true,
      uploadFile: {
        uploadUrl: 'http://api.test/uploads/abc?token=t',
        assetUrl: 'http://api.test/uploads/abc',
        headers: [{ key: 'Content-Type', value: 'image/png' }],
      },
    },
  },
});

const image = () => new File(['png'], 'me.png', { type: 'image/png' });

describe('uploadAvatar', () => {
  it('uploads to the signed URL, then sets avatarUrl to the asset', async () => {
    route({ fileUpload: signed });
    await mod.uploadAvatar(image());
    assert.equal(calls.length, 3);
    assert.match(calls[0]!.query!, /fileUpload/);
    assert.deepEqual(calls[1], { url: 'http://api.test/uploads/abc?token=t', method: 'PUT' });
    assert.match(calls[2]!.query!, /userUpdate/);
    assert.deepEqual(calls[2]!.variables, {
      id: 'me',
      input: { avatarUrl: 'http://api.test/uploads/abc' },
    });
  });

  it('does not set the avatar when the PUT fails', async () => {
    route({
      fileUpload: signed,
      put: () => new Response(JSON.stringify({ error: 'Too large' }), { status: 400 }),
    });
    await assert.rejects(mod.uploadAvatar(image()), /Too large/);
    assert.equal(calls.length, 2);
  });
});

describe('removeAvatar', () => {
  it('sets avatarUrl to null', async () => {
    route({});
    await mod.removeAvatar();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.variables, { id: 'me', input: { avatarUrl: null } });
  });
});
