import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { documentSlugFromHash, documentTitle, sortDocuments, syncDraft } from '@/utils/documents';

describe('documentTitle', () => {
  it('trims the title', () => {
    assert.equal(documentTitle('  Spec  '), 'Spec');
  });

  it('falls back to Untitled for an empty title', () => {
    assert.equal(documentTitle('   '), 'Untitled');
    assert.equal(documentTitle(null), 'Untitled');
  });
});

describe('sortDocuments', () => {
  it('lists the most recently updated first, then by title', () => {
    const docs = [
      { id: 'a', title: 'B', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', title: 'A', updatedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'c', title: 'A', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    assert.deepEqual(
      sortDocuments(docs).map((d) => d.id),
      ['b', 'c', 'a'],
    );
  });
});

describe('syncDraft', () => {
  const base = { server: 'a', draft: 'a', synced: 'a', editing: false };

  it('takes a new server value when the field is idle and unchanged', () => {
    assert.deepEqual(syncDraft({ ...base, server: 'b' }), { draft: 'b', synced: 'b' });
  });

  it('keeps the draft while the user is editing', () => {
    assert.deepEqual(syncDraft({ ...base, server: 'b', draft: 'typing', editing: true }), {
      draft: 'typing',
      synced: 'a',
    });
  });

  it('keeps an unsaved change even when the field is not focused', () => {
    assert.deepEqual(syncDraft({ ...base, server: 'b', draft: 'mine' }), {
      draft: 'mine',
      synced: 'a',
    });
  });

  it('accepts its own save coming back', () => {
    assert.deepEqual(syncDraft({ ...base, server: 'mine', draft: 'mine', editing: true }), {
      draft: 'mine',
      synced: 'mine',
    });
  });
});

describe('documentSlugFromHash', () => {
  it('reads the slug of a #document- fragment', () => {
    assert.equal(documentSlugFromHash('#document-6194924108f3'), '6194924108f3');
    assert.equal(documentSlugFromHash(''), null);
    assert.equal(documentSlugFromHash('#comment-1'), null);
    assert.equal(documentSlugFromHash('#document-'), null);
  });
});
