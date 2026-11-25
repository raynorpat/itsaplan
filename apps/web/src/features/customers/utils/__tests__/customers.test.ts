import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatRevenue,
  issuesOfCustomer,
  parseDomains,
  parseWholeNumber,
  sortCustomers,
  type CustomerSortRow,
} from '../customers';

const row = (over: Partial<CustomerSortRow>): CustomerSortRow => ({
  name: 'Acme',
  requests: 0,
  people: 0,
  revenue: null,
  ...over,
});

describe('sortCustomers', () => {
  const rows = [
    row({ name: 'beta', requests: 3, revenue: 100 }),
    row({ name: 'Acme', requests: 1, revenue: null }),
    row({ name: 'Cobalt', requests: 5, revenue: 50 }),
  ];
  it('sorts by name, case-insensitively', () => {
    assert.deepEqual(
      sortCustomers(rows, 'name', 'asc').map((r) => r.name),
      ['Acme', 'beta', 'Cobalt'],
    );
  });
  it('sorts by requests, most first when descending', () => {
    assert.deepEqual(
      sortCustomers(rows, 'requests', 'desc').map((r) => r.name),
      ['Cobalt', 'beta', 'Acme'],
    );
  });
  it('puts customers without revenue last in both directions', () => {
    assert.deepEqual(
      sortCustomers(rows, 'revenue', 'desc').map((r) => r.name),
      ['beta', 'Cobalt', 'Acme'],
    );
    assert.deepEqual(
      sortCustomers(rows, 'revenue', 'asc').map((r) => r.name),
      ['Cobalt', 'beta', 'Acme'],
    );
  });
  it('does not change the input', () => {
    sortCustomers(rows, 'name', 'asc');
    assert.equal(rows[0]!.name, 'beta');
  });
});

describe('formatRevenue', () => {
  it('formats in compact form in the workspace currency', () => {
    assert.equal(formatRevenue(1_250_000, 'USD'), '$1.3M');
    assert.equal(formatRevenue(900, 'USD'), '$900');
  });
  it('shows a dash without revenue', () => {
    assert.equal(formatRevenue(null, 'USD'), '—');
  });
});

describe('issuesOfCustomer', () => {
  const issue = (id: string) => ({
    id,
    identifier: id.toUpperCase(),
    title: `Issue ${id}`,
    state: { name: 'Todo', type: 'unstarted' as const, color: '#999' },
  });
  it('groups requests by issue, most requests first, then the latest request', () => {
    const groups = issuesOfCustomer([
      { issue: issue('a'), priority: 0, createdAt: '2026-11-01T00:00:00.000Z' },
      { issue: issue('b'), priority: 1, createdAt: '2026-11-05T00:00:00.000Z' },
      { issue: issue('a'), priority: 1, createdAt: '2026-11-03T00:00:00.000Z' },
      { issue: issue('c'), priority: 0, createdAt: '2026-11-09T00:00:00.000Z' },
    ]);
    assert.deepEqual(
      groups.map((g) => [g.issue.id, g.requests, g.important, g.lastAt]),
      [
        ['a', 2, 1, '2026-11-03T00:00:00.000Z'],
        ['c', 1, 0, '2026-11-09T00:00:00.000Z'],
        ['b', 1, 1, '2026-11-05T00:00:00.000Z'],
      ],
    );
  });
  it('leaves out requests without an issue', () => {
    assert.deepEqual(
      issuesOfCustomer([{ issue: null, priority: 0, createdAt: '2026-11-01T00:00:00.000Z' }]),
      [],
    );
  });
});

describe('parseDomains', () => {
  it('splits on commas, spaces and new lines and drops empties and repeats', () => {
    assert.deepEqual(parseDomains(' acme.com, Acme.io\nacme.com  '), ['acme.com', 'acme.io']);
    assert.deepEqual(parseDomains(''), []);
  });
});

describe('parseWholeNumber', () => {
  it('reads an empty field as no value', () => {
    assert.equal(parseWholeNumber('  '), null);
  });
  it('reads whole nonnegative numbers, ignoring thousands separators', () => {
    assert.equal(parseWholeNumber('1,250,000'), 1_250_000);
    assert.equal(parseWholeNumber('0'), 0);
  });
  it('refuses fractions, negatives and text', () => {
    assert.equal(parseWholeNumber('1.5'), undefined);
    assert.equal(parseWholeNumber('-3'), undefined);
    assert.equal(parseWholeNumber('ten'), undefined);
  });
});
