import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  columnChoices,
  initialStatusChoices,
  jiraHostInput,
  isCsvImport,
  mappingFromChoices,
  statusMappingInput,
  statusOptions,
  statusValues,
  validateColumns,
  type ColumnMapping,
} from '../csvImport';
import { SERVICE_LABEL } from '../imports';

const guess: ColumnMapping = {
  title: 0,
  description: 1,
  status: 2,
  priority: null,
  dateFormat: 'iso',
};

describe('column mapping', () => {
  it('turns a guess into one choice per field, unmapped fields empty', () => {
    const choices = columnChoices(guess);
    assert.equal(choices.title, 0);
    assert.equal(choices.description, 1);
    assert.equal(choices.status, 2);
    assert.equal(choices.priority, null);
    assert.equal(choices.labels, null);
  });

  it('requires a title column', () => {
    const choices = { ...columnChoices(guess), title: null };
    assert.equal(validateColumns(choices), 'Choose the column that holds the title');
  });

  it('refuses one column used for two fields', () => {
    const choices = { ...columnChoices(guess), labels: 1 };
    assert.equal(validateColumns(choices), 'Each column can be used once');
  });

  it('accepts a valid mapping and builds the request body', () => {
    const choices = { ...columnChoices(guess), assignee: 3 };
    assert.equal(validateColumns(choices), null);
    assert.deepEqual(mappingFromChoices(choices, 'dayFirst'), {
      title: 0,
      description: 1,
      status: 2,
      assignee: 3,
      dateFormat: 'dayFirst',
    });
  });
});

describe('status mapping', () => {
  const states = [
    { id: 's3', name: 'Done', type: 'completed', position: 3 },
    { id: 's1', name: 'Todo', type: 'unstarted', position: 1 },
    { id: 's0', name: 'Backlog', type: 'backlog', position: 0 },
    { id: 's2', name: 'In Progress', type: 'started', position: 2 },
  ];

  it('lists the file statuses from the import metadata', () => {
    assert.deepEqual(statusValues({ statuses: ['Open', 'Done', 3, ''] }), ['Open', 'Done']);
    assert.deepEqual(statusValues({}), []);
  });

  it('leaves archived states out', () => {
    const withArchived = [
      ...states,
      { id: 'sx', name: 'Old', type: 'started', position: 9, archivedAt: '2026-01-01' },
    ];
    assert.equal(
      statusOptions(withArchived).some((o) => o.value === 'sx'),
      false,
    );
  });

  it('starts each status on the guessed state', () => {
    assert.deepEqual(
      initialStatusChoices(['Done', 'Parked'], {
        statusGuesses: { Done: 's3', Parked: 's1' },
      }),
      { Done: 's3', Parked: 's1' },
    );
    assert.deepEqual(initialStatusChoices(['Done'], {}), {});
  });

  it('offers states in workflow order', () => {
    assert.deepEqual(
      statusOptions(states).map((o) => o.label),
      ['Backlog', 'Todo', 'In Progress', 'Done'],
    );
    assert.equal(statusOptions(states)[0]!.value, 's0');
  });

  it("offers a new team's default states by name", () => {
    assert.deepEqual(
      statusOptions(null).map((o) => o.value),
      ['Backlog', 'Todo', 'In Progress', 'Done', 'Canceled'],
    );
  });

  it('sends every chosen state', () => {
    assert.deepEqual(statusMappingInput({ Open: 's1', Shipped: 's3', Empty: '' }), {
      Open: 's1',
      Shipped: 's3',
    });
  });
});

describe('the upload and the Jira form', () => {
  it('sends a typed Jira host, or nothing when empty', () => {
    assert.equal(jiraHostInput('  acme.atlassian.net '), 'acme.atlassian.net');
    assert.equal(jiraHostInput('   '), undefined);
  });
});

describe('CSV imports', () => {
  it('recognises Jira and generic CSV imports and labels them', () => {
    assert.equal(isCsvImport({ service: 'jira' }), true);
    assert.equal(isCsvImport({ service: 'csv' }), true);
    assert.equal(isCsvImport({ service: 'gitlab' }), false);
    assert.equal(SERVICE_LABEL.jira, 'Jira');
    assert.equal(SERVICE_LABEL.csv, 'CSV');
  });
});
