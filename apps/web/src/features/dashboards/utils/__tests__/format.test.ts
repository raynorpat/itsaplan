import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { csvFileName } from '../download';
import { changeText, formatValue } from '../format';

describe('formatValue', () => {
  it('shows days with one decimal, percentages whole, counts rounded', () => {
    assert.equal(formatValue(3.456, 'days'), '3.5 d');
    assert.equal(formatValue(41.6, 'percent'), '42%');
    assert.equal(formatValue(12.25, 'count'), '12.3');
    assert.equal(formatValue(null, 'count'), '–');
  });
});

describe('changeText', () => {
  it('describes the change against the previous period', () => {
    assert.equal(changeText(124, 100), '▲ 24% vs previous period');
    assert.equal(changeText(80, 100), '▼ 20% vs previous period');
    assert.equal(changeText(5, 5), 'Same as previous period');
    assert.equal(changeText(5, 0), 'None in the previous period');
    assert.equal(changeText(5, null), null);
    assert.equal(changeText(null, 3), null);
  });
});

describe('csvFileName', () => {
  it('keeps letters and digits', () => {
    assert.equal(csvFileName('Requests per week (by source)'), 'requests-per-week-by-source.csv');
    assert.equal(csvFileName('  '), 'widget.csv');
  });
});
