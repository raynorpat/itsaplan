import { describe, expect, it } from 'bun:test';
import { MAX_CSV_ROWS, parseCsv } from '../../parse';

describe('parseCsv', () => {
  it('reads headers and rows separated by commas', () => {
    expect(parseCsv('Summary,Status\nFirst,Done\nSecond,To Do\n')).toEqual({
      headers: ['Summary', 'Status'],
      rows: [
        ['First', 'Done'],
        ['Second', 'To Do'],
      ],
    });
  });

  it('keeps quoted commas, doubled quotes and newlines in one value', () => {
    const text = 'Summary,Description\n"A, B","He said ""hi""\nsecond line"\n';
    expect(parseCsv(text).rows).toEqual([['A, B', 'He said "hi"\nsecond line']]);
  });

  it('detects a semicolon delimiter from the header line', () => {
    expect(parseCsv('Title;Status\r\nOne;Open\r\n')).toEqual({
      headers: ['Title', 'Status'],
      rows: [['One', 'Open']],
    });
  });

  it('keeps a quoted semicolon in a comma file and a quoted comma in a semicolon file', () => {
    expect(parseCsv('A,B\n"x;y",z\n').rows).toEqual([['x;y', 'z']]);
    expect(parseCsv('A;B\n"x,y";z\n').rows).toEqual([['x,y', 'z']]);
  });

  it('strips a byte order mark and skips blank lines', () => {
    expect(parseCsv('﻿Title\nOne\n\n\nTwo\n')).toEqual({
      headers: ['Title'],
      rows: [['One'], ['Two']],
    });
  });

  it('keeps repeated headers by position', () => {
    const parsed = parseCsv('Summary,Labels,Labels\nOne,ui,bug\n');
    expect(parsed.headers).toEqual(['Summary', 'Labels', 'Labels']);
    expect(parsed.rows).toEqual([['One', 'ui', 'bug']]);
  });

  it('pads short rows to the header width', () => {
    expect(parseCsv('A,B,C\nx\n').rows).toEqual([['x', '', '']]);
  });

  it('keeps cell text that looks like a formula as plain text', () => {
    expect(parseCsv('Title\n=SUM(A1:A2)\n').rows).toEqual([['=SUM(A1:A2)']]);
  });

  it('refuses a file without a header line', () => {
    expect(() => parseCsv('')).toThrow('The file is empty');
  });

  it(`refuses more than ${MAX_CSV_ROWS} rows`, () => {
    const ok = 'Title\n' + 'x\n'.repeat(MAX_CSV_ROWS);
    expect(parseCsv(ok).rows).toHaveLength(MAX_CSV_ROWS);
    expect(() => parseCsv(ok + 'x\n')).toThrow('At most 10,000 rows per import');
  });
});
