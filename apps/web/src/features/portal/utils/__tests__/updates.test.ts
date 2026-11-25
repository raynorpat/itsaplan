import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cadenceLabel, updatesSummary, type UpdatePrefs } from '../updates';

const prefs = (over: Partial<UpdatePrefs> = {}): UpdatePrefs => ({
  enabled: true,
  unsubscribed: false,
  changeEmails: true,
  summary: 'weekly',
  ...over,
});

describe('cadenceLabel', () => {
  it('names each cadence', () => {
    assert.equal(cadenceLabel('weekly'), 'Weekly');
    assert.equal(cadenceLabel('daily'), 'Daily');
    assert.equal(cadenceLabel('off'), 'Off');
  });
});

describe('updatesSummary', () => {
  it('is Off when the main switch is off, whatever the rest says', () => {
    assert.equal(updatesSummary(prefs({ enabled: false })), 'Off');
    assert.equal(updatesSummary(prefs({ enabled: false, unsubscribed: true })), 'Off');
  });

  it('names changes and the summary cadence', () => {
    assert.equal(updatesSummary(prefs()), 'Changes and a weekly summary');
    assert.equal(updatesSummary(prefs({ summary: 'daily' })), 'Changes and a daily summary');
  });

  it('names one part when the other is off', () => {
    assert.equal(updatesSummary(prefs({ changeEmails: false })), 'Weekly summary only');
    assert.equal(
      updatesSummary(prefs({ changeEmails: false, summary: 'daily' })),
      'Daily summary only',
    );
    assert.equal(updatesSummary(prefs({ summary: 'off' })), 'Changes only');
  });

  it('is Off when both parts are off', () => {
    assert.equal(updatesSummary(prefs({ changeEmails: false, summary: 'off' })), 'Off');
  });
});
