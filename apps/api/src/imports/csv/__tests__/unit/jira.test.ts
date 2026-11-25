import { describe, expect, it } from 'bun:test';
import { parseCsv } from '../../parse';
import { isJiraCsv, readJiraCsv } from '../../jira';

const csv = [
  'Summary,Issue key,Issue id,Status,Priority,Assignee,Reporter,Created,Resolved,Due date,Labels,Labels,Description,Comment,Comment,Custom field (Story Points)',
  'Fix login,ENG-12,10012,Done,Highest,Ann Lee,bob@example.com,25/Nov/26 10:15 AM,26/Nov/26 9:00 AM,01/Dec/26 12:00 AM,auth,urgent-fix,h2. Steps,"25/Nov/26 11:00 AM;acc-1;First *note*","26/Nov/26 8:00 AM;acc-2;Second; with semicolon",5',
  'No title row,ENG-13,,,,,,25/Nov/26 10:15 AM,,,,,,,,',
  ',ENG-14,,To Do,,,,,,,,,,,,',
  'Odd values,ENG-15,,Weird,P9,,,later,,,,,,,,x',
].join('\n');

describe('isJiraCsv', () => {
  it('needs a Summary column', () => {
    expect(isJiraCsv(['summary', 'Status'])).toBe(true);
    expect(isJiraCsv(['Title', 'Status'])).toBe(false);
  });
});

describe('readJiraCsv', () => {
  const out = readJiraCsv(parseCsv(csv), 'abc');
  const first = out.data.issues[0]!;

  it('reads every field of a row', () => {
    expect(out.data.serviceLabel).toBe('Jira');
    expect(first).toMatchObject({
      sourceKey: 'jira:ENG-12',
      number: 12,
      title: 'Fix login',
      body: '## Steps',
      status: 'Done',
      priority: 1,
      estimate: 5,
      createdAt: '2026-11-25T10:15:00.000Z',
      closedAt: '2026-11-26T09:00:00.000Z',
      dueDate: '2026-12-01',
    });
    expect(first.assignee).toMatchObject({ name: 'Ann Lee' });
    expect(first.author).toMatchObject({ email: 'bob@example.com' });
  });

  it('keeps every value of repeated Labels and Comment columns', () => {
    expect(first.labels.map((l) => l.name)).toEqual(['auth', 'urgent-fix']);
    expect(first.comments.map((c) => c.body)).toEqual(['First **note**', 'Second; with semicolon']);
    expect(first.comments[0]).toMatchObject({
      createdAt: '2026-11-25T11:00:00.000Z',
      author: { key: 'name:acc-1' },
    });
  });

  it('skips rows without a title and lists them by row number', () => {
    expect(out.data.issues.map((i) => i.sourceKey)).toEqual([
      'jira:ENG-12',
      'jira:ENG-13',
      'jira:ENG-15',
    ]);
    expect(out.skipped).toEqual([{ row: 4, reason: 'No title' }]);
  });

  it('collects distinct statuses and counts values that did not read', () => {
    expect(out.statuses).toEqual(['Done', 'Weird']);
    expect(out.counts).toEqual({ badDates: 1, missingCreated: 1, badPriority: 1, badEstimate: 1 });
    const odd = out.data.issues[2]!;
    expect(odd.priority).toBe(0);
    expect(odd.estimate).toBeNull();
    expect(odd.createdAt).toBe('');
  });
});
