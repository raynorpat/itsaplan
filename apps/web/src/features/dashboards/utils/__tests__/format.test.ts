import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { csvFileName } from '../download';
import { axisLabel, cellText, changeText, excludedText, formatValue } from '../format';

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

describe('excludedText', () => {
  it('says why issues were left out, per measure', () => {
    assert.equal(excludedText('cycleTime', 2), '2 left out (completed without being started)');
    assert.equal(
      excludedText('timeToStart', 1),
      '1 left out (no start date, or started before the first request)',
    );
    assert.equal(excludedText('timeToDone', 3), '3 left out (completed before the first request)');
    assert.equal(excludedText('other', 4), '4 left out (no date)');
  });
});

describe('axisLabel', () => {
  it('keeps short labels and cuts long ones with an ellipsis', () => {
    assert.equal(axisLabel('Urgent'), 'Urgent');
    assert.equal(axisLabel('A very long project name indeed'), 'A very long projec…');
  });
});

describe('formatValue revenue', () => {
  it('shows revenue compact', () => {
    assert.equal(formatValue(1250000, 'revenue'), '1.3M');
    assert.equal(formatValue(900, 'revenue'), '900');
  });
});

describe('cellText', () => {
  it('shows revenue columns compact and leaves other cells as they are', () => {
    assert.equal(cellText('revenue', 1250000), '1.3M');
    assert.equal(cellText('customerRevenue', 340000), '340K');
    assert.equal(cellText('requests', 4), '4');
    assert.equal(cellText('title', 'Export to CSV'), 'Export to CSV');
    assert.equal(cellText('revenue', null), '–');
  });
});
