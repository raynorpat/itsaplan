import { describe, expect, it } from 'bun:test';
import { parseCsv } from '../../parse';
import { readGenericCsv } from '../../generic';

const parsed = parseCsv(
  [
    'Key,Title,Body,State,Priority,Who,By,Tags,Made,Due,Finished,Points',
    'A-1,First,Text,Doing,High,ann@x.io,Bob,"ui, Bug; ui",03/04/2026,05/04/2026,,2',
    ',Second,,,,,,,,,,',
    'A-3,,,,,,,,,,,',
  ].join('\n'),
);

const mapping = {
  id: 0,
  title: 1,
  description: 2,
  status: 3,
  priority: 4,
  assignee: 5,
  creator: 6,
  labels: 7,
  createdAt: 8,
  dueDate: 9,
  completedAt: 10,
  estimate: 11,
  dateFormat: 'dayFirst' as const,
};

describe('readGenericCsv', () => {
  const out = readGenericCsv(parsed, mapping, 'sha');

  it('reads mapped columns', () => {
    expect(out.data.serviceLabel).toBe('CSV');
    expect(out.data.issues[0]).toMatchObject({
      sourceKey: 'csv:A-1',
      title: 'First',
      body: 'Text',
      status: 'Doing',
      priority: 2,
      estimate: 2,
      createdAt: '2026-04-03T00:00:00.000Z',
      dueDate: '2026-04-05',
      closedAt: null,
    });
    expect(out.data.issues[0]!.labels.map((l) => l.name)).toEqual(['ui', 'Bug']);
    expect(out.data.issues[0]!.assignee).toMatchObject({ email: 'ann@x.io' });
    expect(out.data.issues[0]!.author).toMatchObject({ name: 'Bob' });
  });

  it('keys rows without an ID by file and row number', () => {
    expect(out.data.issues[1]!.sourceKey).toBe('csv:sha:3');
    expect(out.skipped).toEqual([{ row: 4, reason: 'No title' }]);
    expect(out.counts.missingCreated).toBe(1);
  });

  it('refuses a mapping outside the file or using a column twice', () => {
    expect(() => readGenericCsv(parsed, { title: 40, dateFormat: 'iso' }, 'sha')).toThrow(
      'is not a column of the file',
    );
    expect(() =>
      readGenericCsv(parsed, { title: 1, description: 1, dateFormat: 'iso' }, 'sha'),
    ).toThrow('Each column can be used once');
  });
});
