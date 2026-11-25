import { describe, expect, it } from 'bun:test';
import { open, seal } from '../../secret-box';

// Secrets stored in the database (the AI endpoint's API key) are sealed with
// AES-256-GCM under a key derived from BETTER_AUTH_SECRET.

describe('secret box', () => {
  it('opens what it sealed', () => {
    const sealed = seal('sk-very-secret');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed.split('.')).toHaveLength(4);
    expect(sealed).not.toContain('sk-very-secret');
    expect(open(sealed)).toBe('sk-very-secret');
  });

  it('seals the same text differently each time', () => {
    expect(seal('same')).not.toBe(seal('same'));
  });

  it('refuses a tampered value', () => {
    const [v, iv, tag, ct] = seal('sk-very-secret').split('.');
    const flipped = ct!.slice(0, -2) + (ct!.endsWith('AA') ? 'BB' : 'AA');
    expect(() => open([v, iv, tag, flipped].join('.'))).toThrow();
    expect(() => open('v2.a.b.c')).toThrow();
  });
});
