import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateSettingsInput, parseDefaultEstimate } from '../estimateSettings';

describe('estimateSettingsInput', () => {
  it("maps the form to Linear's teamUpdate fields", () => {
    assert.deepEqual(
      estimateSettingsInput({
        type: 'tShirt',
        extended: true,
        allowZero: false,
        defaultEstimate: 2,
      }),
      {
        issueEstimationType: 'tShirt',
        issueEstimationExtended: true,
        issueEstimationAllowZero: false,
        defaultIssueEstimate: 2,
      },
    );
  });
});

describe('parseDefaultEstimate', () => {
  it('accepts zero and positive numbers', () => {
    assert.equal(parseDefaultEstimate('0'), 0);
    assert.equal(parseDefaultEstimate('1'), 1);
    assert.equal(parseDefaultEstimate(' 2.5 '), 2.5);
  });
  it('refuses empty, negative and non-numbers', () => {
    assert.equal(parseDefaultEstimate(''), null);
    assert.equal(parseDefaultEstimate('-1'), null);
    assert.equal(parseDefaultEstimate('abc'), null);
  });
});
