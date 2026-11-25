import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toCsv } from '../csv';
import { widget } from './fixtures';

describe('toCsv', () => {
  it('writes bars with share, quoting per RFC 4180', () => {
    const w = widget('chart', { data: 'requests', measure: 'requests', slice: 'source' });
    const csv = toCsv(w, {
      kind: 'bars',
      rows: [
        { key: 'a', label: 'Say "hi", there', value: 3, share: 0.75, segments: [] },
        { key: 'b', label: 'Two\nlines', value: 1, share: 0.25, segments: [] },
      ],
      excluded: 0,
      capped: false,
    });
    assert.equal(
      csv,
      'Source,Requests,Share\r\n"Say ""hi"", there",3,75.0%\r\n"Two\nlines",1,25.0%\r\n',
    );
  });

  it('writes one row per segment when a segment is set', () => {
    const w = widget('chart', {
      data: 'issues',
      measure: 'open',
      slice: 'status',
      segment: 'priority',
    });
    const csv = toCsv(w, {
      kind: 'bars',
      rows: [
        {
          key: 's',
          label: 'Todo',
          value: 2,
          share: 1,
          segments: [{ key: '1', label: 'Urgent', value: 2 }],
        },
      ],
      excluded: 0,
      capped: false,
    });
    assert.equal(csv, 'Status,Priority,Open issues\r\nTodo,Urgent,2\r\n');
  });

  it('guards against spreadsheet formulas', () => {
    const w = widget('table', {
      data: 'issues',
      measure: 'open',
      table: { columns: ['title'], limit: 5, sort: 'title:asc' },
    });
    const csv = toCsv(w, {
      kind: 'table',
      columns: [{ id: 'title', label: 'Title' }],
      rows: ['=SUM(A1)', '+1', '-2', '@x', '\tx', 'ok'].map((t, i) => ({
        id: String(i),
        href: null,
        cells: { title: t },
      })),
      excluded: 0,
      capped: false,
    });
    assert.equal(csv, "Title\r\n'=SUM(A1)\r\n'+1\r\n'-2\r\n'@x\r\n'\tx\r\nok\r\n");
  });

  it('writes over time weekly, and a number with its period', () => {
    const w = widget('chart', {
      data: 'issues',
      measure: 'created',
      compareMeasure: 'completed',
      chart: 'overTimeLine',
    });
    const csv = toCsv(w, {
      kind: 'overTime',
      series: [
        { key: 'created', label: 'Issues created' },
        { key: 'completed', label: 'Issues completed' },
      ],
      weeks: [{ week: '2026-11-02', values: { created: 1, completed: 2 } }],
      excluded: 0,
      capped: false,
    });
    assert.equal(csv, 'Week,Issues created,Issues completed\r\n2026-11-02,1,2\r\n');
    const n = widget('number', { data: 'requests', measure: 'people' });
    assert.equal(
      toCsv(n, {
        kind: 'number',
        value: 4,
        previous: null,
        unit: 'count',
        start: '2026-10-25T00:00:00.000Z',
        end: '2026-11-24T12:00:00.000Z',
        excluded: 0,
        capped: false,
      }),
      'Measure,Period start,Period end,Value,Previous\r\nPeople,2026-10-25,2026-11-24,4,\r\n',
    );
  });
});
