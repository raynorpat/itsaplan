import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  destinationInput,
  importIsRunning,
  NEW_TEAM,
  importStatusText,
  peopleMappingInput,
  type ImportView,
} from '../imports';

const base: ImportView = {
  id: 'i1',
  service: 'gitea',
  status: 'inProgress',
  progress: null,
  displayName: 'acme/api',
  teamId: 't1',
  teamName: null,
  creatorId: 'u1',
  serviceMetadata: {},
  summary: null,
  error: null,
  awaitingPeople: false,
  createdAt: '2026-11-24T10:00:00.000Z',
  updatedAt: '2026-11-24T10:00:00.000Z',
};

const summary = (issues: number, skippedExisting: number, skipped: number, total: number) => ({
  issues,
  skippedExisting,
  comments: 0,
  labelsCreated: 0,
  total,
  skipped: Array.from({ length: skipped }, (_, i) => ({ url: `u${i}`, reason: 'r' })),
});

describe('importStatusText', () => {
  it('reads fetching while the source is read', () => {
    assert.equal(importStatusText(base), 'Fetching issues…');
  });

  it('asks for people matching once fetched', () => {
    assert.equal(importStatusText({ ...base, awaitingPeople: true }), 'Match people to continue');
  });

  it('counts processed issues while creating records', () => {
    const imp = { ...base, status: 'inProcess' as const, summary: summary(100, 15, 5, 450) };
    assert.equal(importStatusText(imp), 'Imported 120 of 450 issues');
  });

  it('reads starting before the first progress update', () => {
    assert.equal(importStatusText({ ...base, status: 'inProcess' }), 'Starting…');
  });

  it('reads complete and shows the error text', () => {
    assert.equal(importStatusText({ ...base, status: 'complete' }), 'Complete');
    assert.equal(
      importStatusText({ ...base, status: 'error', error: 'Interrupted, run the import again' }),
      'Interrupted, run the import again',
    );
    assert.equal(importStatusText({ ...base, status: 'error' }), 'Failed');
  });
});

describe('importIsRunning', () => {
  it('is true while fetching or processing, not while waiting for people', () => {
    assert.equal(importIsRunning(base), true);
    assert.equal(importIsRunning({ ...base, status: 'inProcess' }), true);
    assert.equal(importIsRunning({ ...base, awaitingPeople: true }), false);
    assert.equal(importIsRunning({ ...base, status: 'complete' }), false);
    assert.equal(importIsRunning({ ...base, status: 'error' }), false);
  });
});

describe('peopleMappingInput', () => {
  it('maps each source person to the chosen member or null', () => {
    assert.deepEqual(
      peopleMappingInput([
        { key: 'gh:octocat', memberId: 'm1' },
        { key: 'gh:ghost', memberId: null },
        { key: 'gh:empty', memberId: '' },
      ]),
      { 'gh:octocat': 'm1', 'gh:ghost': null, 'gh:empty': null },
    );
  });
});

describe('destinationInput', () => {
  it('uses an existing team', () => {
    assert.deepEqual(
      destinationInput({ team: 't1', newTeamName: '', includeClosed: true, labels: '' }),
      { teamId: 't1', teamName: null, includeClosed: true, labels: [] },
    );
  });

  it('creates a team by name and splits the label filter', () => {
    assert.deepEqual(
      destinationInput({
        team: NEW_TEAM,
        newTeamName: '  Platform ',
        includeClosed: false,
        labels: 'bug, help wanted ,, ',
      }),
      { teamId: null, teamName: 'Platform', includeClosed: false, labels: ['bug', 'help wanted'] },
    );
  });

  it('asks for a team or a team name', () => {
    assert.deepEqual(
      destinationInput({ team: '', newTeamName: '', includeClosed: false, labels: '' }),
      { error: 'Choose a team to import into' },
    );
    assert.deepEqual(
      destinationInput({ team: NEW_TEAM, newTeamName: '  ', includeClosed: false, labels: '' }),
      { error: 'Name the new team' },
    );
  });
});
