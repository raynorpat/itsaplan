import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boardFormErrors, emptyBoardForm, formToInput, parseList, portalUrl } from '../board';

describe('parseList', () => {
  it('splits on commas and newlines, lowercases and drops duplicates and blanks', () => {
    assert.deepEqual(parseList('Example.com, acme.io\n\nEXAMPLE.com ,'), [
      'example.com',
      'acme.io',
    ]);
  });

  it('is empty for blank text', () => {
    assert.deepEqual(parseList('  \n '), []);
  });
});

describe('portalUrl', () => {
  it('joins the origin and the board address', () => {
    assert.equal(
      portalUrl('feedback', 'https://plan.example.com'),
      'https://plan.example.com/portal/feedback',
    );
  });
});

describe('boardFormErrors', () => {
  const valid = { ...emptyBoardForm(), name: 'Feedback', slug: 'feedback', teamId: 't1' };

  it('accepts a complete team board', () => {
    assert.deepEqual(boardFormErrors(valid), {});
  });

  it('needs a name and a lowercase address', () => {
    const errors = boardFormErrors({ ...valid, name: ' ', slug: 'Feed Back' });
    assert.equal(errors.name, 'Enter a name');
    assert.equal(errors.slug, 'Use 1–48 lowercase letters, digits or dashes');
  });

  it('needs the team or the project the board shows', () => {
    assert.equal(boardFormErrors({ ...valid, teamId: '' }).source, 'Choose a team');
    assert.equal(
      boardFormErrors({ ...valid, source: 'project', teamId: '', projectId: '' }).source,
      'Choose a project',
    );
  });

  it('checks domains and addresses of a restricted board, and needs one of them', () => {
    const restricted = { ...valid, access: 'restricted' as const };
    assert.equal(
      boardFormErrors(restricted).access,
      'Add an email domain or an address that may sign in',
    );
    assert.equal(
      boardFormErrors({ ...restricted, domains: 'example.com, not a domain' }).domains,
      '"not a domain" is not a domain',
    );
    assert.equal(
      boardFormErrors({ ...restricted, emails: 'ann@example.com\nann' }).emails,
      '"ann" is not an email address',
    );
    assert.deepEqual(boardFormErrors({ ...restricted, domains: 'example.com' }), {});
  });

  it('needs a team and a status for suggestions', () => {
    const errors = boardFormErrors({ ...valid, suggestionsEnabled: true });
    assert.equal(errors.suggestionTeamId, 'Choose the team suggestions go to');
    assert.equal(errors.suggestionStateId, 'Choose the status of new suggestions');
  });
});

describe('formToInput', () => {
  it('sends the chosen source only, the lists parsed, and no suggestion fields when off', () => {
    const input = formToInput({
      ...emptyBoardForm(),
      name: ' Feedback ',
      slug: 'feedback',
      source: 'project',
      teamId: 't1',
      projectId: 'p1',
      access: 'restricted',
      domains: 'Example.com',
      suggestionTeamId: 't1',
    });
    assert.equal(input.name, 'Feedback');
    assert.equal(input.teamId, null);
    assert.equal(input.projectId, 'p1');
    assert.deepEqual(input.allowedDomains, ['example.com']);
    assert.equal(input.suggestionsEnabled, false);
    assert.equal(input.suggestionTeamId, null);
  });
});
