import { describe, it, expect } from 'bun:test';
import { parseMentions } from '../../mentions';

// Mentions are stored inline in a comment body as @[Display Name](user:<userId>).
// parseMentions extracts the referenced user ids. It is pure, so this is a unit test.

describe('parseMentions', () => {
  it('extracts the user id from a single mention', () => {
    expect(parseMentions('hey @[Design Bot](user:abc-123) look')).toEqual(['abc-123']);
  });

  it('extracts several mentions in first-seen order', () => {
    const body = '@[A](user:id-a) and @[B](user:id-b)';
    expect(parseMentions(body)).toEqual(['id-a', 'id-b']);
  });

  it('deduplicates a user mentioned more than once', () => {
    const body = '@[A](user:id-a) ... @[A again](user:id-a)';
    expect(parseMentions(body)).toEqual(['id-a']);
  });

  it('returns nothing for a body without mentions', () => {
    expect(parseMentions('plain comment, no tags')).toEqual([]);
  });

  it('ignores an @name that is not a full token', () => {
    expect(parseMentions('email me @someone or @[x](user:) later')).toEqual([]);
  });
});
