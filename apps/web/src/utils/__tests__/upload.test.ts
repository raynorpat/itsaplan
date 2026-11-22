import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

// uploadFile: asks fileUpload for a signed URL, PUTs the bytes with the headers it
// returns, then records the attachment on the issue. A refusal at any step creates
// nothing and surfaces the API's message.

process.env.NEXT_PUBLIC_API_URL = 'http://api.test';

type UploadModule = typeof import('../upload');
let mod: UploadModule;

before(async () => {
  mod = await import('../upload');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: string; init: RequestInit; op?: string };
let calls: Call[] = [];

// Routes the mocked fetch: GraphQL operations by name, the PUT by URL.
function route(handlers: {
  fileUpload?: () => unknown;
  put?: () => Response;
  attachmentCreate?: () => unknown;
}) {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith('/graphql')) {
      const query = String(JSON.parse(String(init.body)).query);
      const op = /fileUpload/.test(query) ? 'fileUpload' : 'attachmentCreate';
      calls.push({ url, init, op });
      const body = handlers[op as 'fileUpload' | 'attachmentCreate']?.();
      return new Response(JSON.stringify(body), { status: 200 });
    }
    calls.push({ url, init });
    return handlers.put?.() ?? new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
}

const file = () => new File(['hello'], 'notes.txt', { type: 'text/plain' });

const signed = () => ({
  data: {
    fileUpload: {
      success: true,
      uploadFile: {
        uploadUrl: 'http://api.test/uploads/tok',
        assetUrl: 'http://api.test/uploads/u1/raw',
        headers: [{ key: 'Content-Type', value: 'text/plain' }],
      },
    },
  },
});

const created = () => ({
  data: {
    attachmentCreate: {
      success: true,
      attachment: {
        id: 'a1',
        title: 'notes.txt',
        url: 'http://api.test/uploads/u1/raw',
        metadata: { filename: 'notes.txt', contentType: 'text/plain', size: 5 },
      },
    },
  },
});

describe('uploadFile', () => {
  it('uploads and creates the attachment', async () => {
    route({ fileUpload: signed, attachmentCreate: created });
    const a = await mod.uploadFile('issue-1', file());
    assert.equal(a.id, 'a1');
    assert.equal(a.url, 'http://api.test/uploads/u1/raw');
    assert.equal(a.contentType, 'text/plain');
    const put = calls.find((c) => c.url === 'http://api.test/uploads/tok')!;
    assert.equal(put.init.method, 'PUT');
    assert.equal(new Headers(put.init.headers).get('Content-Type'), 'text/plain');
    const create = calls.find((c) => c.op === 'attachmentCreate')!;
    const vars = JSON.parse(String(create.init.body)).variables;
    assert.deepEqual(vars.input, {
      issueId: 'issue-1',
      url: 'http://api.test/uploads/u1/raw',
      title: 'notes.txt',
    });
  });

  it("surfaces the API's size or type error and creates nothing", async () => {
    route({
      fileUpload: () => ({
        errors: [{ message: 'File is too large', extensions: { code: 'INVALID_INPUT' } }],
      }),
    });
    await assert.rejects(mod.uploadFile('issue-1', file()), /too large/);
    assert.equal(calls.filter((c) => c.op === 'attachmentCreate').length, 0);
    assert.equal(calls.filter((c) => !c.op).length, 0);
  });

  it('does not call attachmentCreate when the PUT fails', async () => {
    route({
      fileUpload: signed,
      put: () => new Response(JSON.stringify({ error: 'Upload expired' }), { status: 410 }),
    });
    await assert.rejects(mod.uploadFile('issue-1', file()), /expired/);
    assert.equal(calls.filter((c) => c.op === 'attachmentCreate').length, 0);
  });
});
