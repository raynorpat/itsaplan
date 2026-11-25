import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { downloadText, REVOKE_AFTER_MS } from '../download';

describe('downloadText', () => {
  it('revokes the file URL only after the download has started', async () => {
    const revoked: string[] = [];
    const clicked: string[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = {
      document: g.document,
      create: URL.createObjectURL,
      revoke: URL.revokeObjectURL,
    };
    g.document = {
      createElement: () => ({
        href: '',
        download: '',
        click(this: { href: string }) {
          clicked.push(this.href);
        },
      }),
    };
    URL.createObjectURL = () => 'blob:1';
    URL.revokeObjectURL = (url: string) => void revoked.push(url);
    try {
      downloadText('a.csv', 'x');
      assert.deepEqual(clicked, ['blob:1']);
      assert.deepEqual(revoked, []);
      await new Promise((r) => setTimeout(r, REVOKE_AFTER_MS + 20));
      assert.deepEqual(revoked, ['blob:1']);
    } finally {
      g.document = saved.document;
      URL.createObjectURL = saved.create;
      URL.revokeObjectURL = saved.revoke;
    }
  });
});
