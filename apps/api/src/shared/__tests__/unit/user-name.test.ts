import { describe, expect, it } from 'bun:test';
import { shownName } from '../../user-name';

describe('shownName', () => {
  it('keeps a set name', () => {
    expect(shownName({ name: 'Pat Owner', email: 'pat@example.com' })).toBe('Pat Owner');
  });

  it('uses the email local part for an empty or blank name', () => {
    expect(shownName({ name: '', email: 'pat.owner@example.com' })).toBe('pat.owner');
    expect(shownName({ name: '   ', email: 'pat.owner@example.com' })).toBe('pat.owner');
    expect(shownName({ name: null, email: 'pat.owner@example.com' })).toBe('pat.owner');
  });
});
