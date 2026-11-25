import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_ESTIMATE_SETTINGS,
  estimateLabel,
  estimateOptions,
  estimatesUsed,
  type TeamEstimateSettings,
  withoutEstimateOptions,
} from '@/utils/estimates';

const settings = (s: Partial<TeamEstimateSettings>): TeamEstimateSettings => ({
  ...DEFAULT_ESTIMATE_SETTINGS,
  ...s,
});
const values = (s: Partial<TeamEstimateSettings>) =>
  estimateOptions(settings(s)).map((o) => o.value);

describe('estimateOptions', () => {
  it('offers nothing while estimates are not used', () => {
    assert.equal(DEFAULT_ESTIMATE_SETTINGS.type, 'notUsed');
    assert.deepEqual(values({}), []);
    assert.equal(estimatesUsed(settings({})), false);
  });

  it("offers each type's scale", () => {
    assert.deepEqual(values({ type: 'exponential' }), [1, 2, 4, 8, 16]);
    assert.deepEqual(values({ type: 'fibonacci' }), [1, 2, 3, 5, 8]);
    assert.deepEqual(values({ type: 'linear' }), [1, 2, 3, 4, 5]);
    assert.deepEqual(values({ type: 'tShirt' }), [1, 2, 3, 5, 8]);
    assert.equal(estimatesUsed(settings({ type: 'linear' })), true);
  });

  it('adds the extended points', () => {
    assert.deepEqual(values({ type: 'exponential', extended: true }), [1, 2, 4, 8, 16, 32, 64]);
    assert.deepEqual(values({ type: 'fibonacci', extended: true }), [1, 2, 3, 5, 8, 13, 21]);
    assert.deepEqual(values({ type: 'linear', extended: true }), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(values({ type: 'tShirt', extended: true }), [1, 2, 3, 5, 8, 13, 21]);
  });

  it('adds zero first when allowed', () => {
    assert.deepEqual(values({ type: 'linear', allowZero: true }), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(values({ allowZero: true }), []);
  });
});

describe('estimateLabel', () => {
  it('shows T-shirt sizes', () => {
    const t = settings({ type: 'tShirt', extended: true, allowZero: true });
    assert.equal(estimateLabel(t, 0), '0');
    assert.equal(estimateLabel(t, 1), 'XS');
    assert.equal(estimateLabel(t, 3), 'M');
    assert.equal(estimateLabel(t, 8), 'XL');
    assert.equal(estimateLabel(t, 13), 'XXL');
    assert.equal(estimateLabel(t, 21), 'XXXL');
    assert.deepEqual(
      estimateOptions(t).map((o) => o.label),
      ['0', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
    );
  });

  it('shows numbers for other types, and a stored value off the scale as its number', () => {
    assert.equal(estimateLabel(settings({ type: 'fibonacci' }), 5), '5');
    assert.equal(estimateLabel(settings({ type: 'tShirt' }), 4), '4');
    assert.equal(estimateLabel(settings({ type: 'linear' }), 2.5), '2.5');
  });
});

describe('withoutEstimateOptions', () => {
  const options = [{ value: 'priority' }, { value: 'estimate' }, { value: 'dueDate' }];
  it('drops the estimate option for a team that does not estimate', () => {
    assert.deepEqual(
      withoutEstimateOptions(options, false).map((o) => o.value),
      ['priority', 'dueDate'],
    );
    assert.deepEqual(withoutEstimateOptions(options, true), options);
  });
});
