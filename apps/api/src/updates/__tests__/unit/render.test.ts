import { describe, expect, it } from 'bun:test';
import type { Change } from '../../changes';
import { renderChangeEmail, renderSummaryEmail, roundUp } from '../../render';

// The text of requester update emails: one round-up line per change, and the change and
// summary emails built from them.

const at = new Date('2026-11-24T10:00:00Z');

const status = (over: Partial<Extract<Change, { kind: 'status' }>> = {}): Change => ({
  kind: 'status',
  issueId: 'i1',
  identifier: 'ENG-1',
  title: 'Dark mode',
  from: 'planned',
  to: 'inProgress',
  duplicateOf: null,
  url: 'https://app.example.com/portal/acme/ENG-1',
  at,
  ...over,
});

const reply = (over: Partial<Extract<Change, { kind: 'reply' }>> = {}): Change => ({
  kind: 'reply',
  issueId: 'i2',
  identifier: 'ENG-2',
  title: 'Export to CSV',
  author: 'Mia',
  body: 'We are on it.',
  url: 'https://app.example.com/portal/acme/ENG-2',
  at,
  ...over,
});

const update: Change = {
  kind: 'projectUpdate',
  projectName: 'Mobile app',
  health: 'onTrack',
  body: 'Beta ships next week.',
  at,
};

describe('roundUp', () => {
  it('writes one line per status change', () => {
    expect(roundUp([status()])).toEqual(['Dark mode moved to In progress']);
    expect(roundUp([status({ to: 'done' })])).toEqual(['Dark mode moved to Done']);
    expect(roundUp([status({ to: 'closed' })])).toEqual(['Dark mode was closed']);
  });

  it('says when an issue was reopened', () => {
    expect(roundUp([status({ title: 'Export to CSV', from: 'done', to: 'inProgress' })])).toEqual([
      'Export to CSV: Reopened, In progress',
    ]);
    expect(roundUp([status({ from: 'closed', to: 'planned' })])).toEqual([
      'Dark mode: Reopened, Planned',
    ]);
  });

  it('names the issue a duplicate was closed for', () => {
    expect(
      roundUp([
        status({
          title: 'Bulk edit',
          to: 'closed',
          duplicateOf: { title: 'Batch edit', url: null },
        }),
      ]),
    ).toEqual(['Bulk edit was closed as a duplicate of Batch edit']);
  });

  it('counts replies per issue', () => {
    expect(roundUp([reply(), reply({ body: 'Done soon.' })])).toEqual([
      '2 new replies on Export to CSV',
    ]);
    expect(roundUp([reply()])).toEqual(['1 new reply on Export to CSV']);
  });

  it('gives a shared project update with its health', () => {
    expect(roundUp([update])).toEqual(['Mobile app: On track']);
    expect(roundUp([{ ...update, health: null }])).toEqual(['Mobile app posted an update']);
  });

  it('keeps the order of the changes', () => {
    expect(roundUp([status(), reply(), update])).toEqual([
      'Dark mode moved to In progress',
      '1 new reply on Export to CSV',
      'Mobile app: On track',
    ]);
  });
});

describe('renderChangeEmail', () => {
  const unsubscribe = 'https://app.example.com/portal/unsubscribe?token=t';

  it('lists every change with replies quoted in full and the unsubscribe link', () => {
    const mail = renderChangeEmail(
      [status(), reply(), update],
      { displayName: 'Jo' },
      'Acme',
      unsubscribe,
    );
    expect(mail.subject).toBe('Updates on what you asked for');
    expect(mail.text).toContain('Hi Jo,');
    expect(mail.text).toContain('Dark mode moved to In progress');
    expect(mail.text).toContain('https://app.example.com/portal/acme/ENG-1');
    expect(mail.text).toContain('Mia replied on Export to CSV:');
    expect(mail.text).toContain('We are on it.');
    expect(mail.text).toContain('Beta ships next week.');
    expect(mail.text).toContain(unsubscribe);
    expect(mail.html).toContain(unsubscribe);
  });

  it('escapes HTML in titles and bodies and has no images', () => {
    const mail = renderChangeEmail(
      [
        status({ title: '<b>Bold</b>' }),
        reply({ body: '<script>alert(1)</script><img src="https://t.example/p.gif">' }),
      ],
      { displayName: 'Jo <x>' },
      'Acme',
      unsubscribe,
    );
    expect(mail.html).not.toContain('<b>Bold</b>');
    expect(mail.html).toContain('&lt;b&gt;Bold&lt;/b&gt;');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img');
    expect(mail.html).not.toContain('Jo <x>');
  });

  it('leaves out the link of a change without one', () => {
    const mail = renderChangeEmail(
      [status({ url: null })],
      { displayName: 'Jo' },
      'Acme',
      unsubscribe,
    );
    expect(mail.text).not.toContain('/portal/acme/ENG-1');
  });
});

describe('renderSummaryEmail', () => {
  const unsubscribe = 'https://app.example.com/portal/unsubscribe?token=t';

  it('names the cadence and lists the round-up', () => {
    const lines = roundUp([status(), update]);
    const weekly = renderSummaryEmail(
      { paragraph: null, lines },
      { displayName: 'Jo' },
      'Acme',
      unsubscribe,
      'weekly',
    );
    expect(weekly.subject).toBe('Your weekly summary');
    expect(weekly.text).toContain('Dark mode moved to In progress');
    expect(weekly.text).toContain('Mobile app: On track');
    expect(weekly.text).toContain(unsubscribe);
    const daily = renderSummaryEmail(
      { paragraph: null, lines },
      { displayName: 'Jo' },
      'Acme',
      unsubscribe,
      'daily',
    );
    expect(daily.subject).toBe('Your daily summary');
  });

  it('puts a written paragraph above the round-up', () => {
    const mail = renderSummaryEmail(
      { paragraph: 'Dark mode is now being built.', lines: ['Dark mode moved to In progress'] },
      { displayName: 'Jo' },
      'Acme',
      unsubscribe,
      'weekly',
    );
    expect(mail.text.indexOf('Dark mode is now being built.')).toBeLessThan(
      mail.text.indexOf('Dark mode moved to In progress'),
    );
  });
});
