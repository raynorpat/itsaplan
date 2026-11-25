import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

// An import file is stored with fileUpload as text/csv and `purpose: import`, whatever
// type the browser reports for it: browsers report CSVs under several types (or none)
// that the API would refuse.

process.env.NEXT_PUBLIC_API_URL = 'http://api.test';

type CsvImportModule = typeof import('../csvImport.service');
let mod: CsvImportModule;

before(async () => {
  mod = await import('../csvImport.service');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('uploadImportFile', () => {
  it('asks for a text/csv import upload whatever type the browser reports', async () => {
    let variables: Record<string, unknown> | undefined;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      if (url.endsWith('/graphql')) {
        variables = (JSON.parse(String(init.body)) as { variables: Record<string, unknown> })
          .variables;
        return new Response(
          JSON.stringify({
            data: {
              fileUpload: {
                uploadFile: {
                  uploadUrl: 'http://api.test/uploads/abc?token=t',
                  assetUrl: 'http://api.test/uploads/abc',
                  headers: [],
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const file = new File(['a,b\n1,2\n'], 'issues.csv', { type: 'application/vnd.ms-excel' });
    assert.equal(await mod.uploadImportFile(file), 'http://api.test/uploads/abc');
    assert.equal(variables?.contentType, 'text/csv');
    assert.deepEqual(variables?.metaData, { purpose: 'import' });
  });
});
