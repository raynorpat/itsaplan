import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  answerErrors,
  emptyAnswers,
  titleAnswer,
  MAX_ANSWER_LENGTH,
  type PublicFormField,
} from '../formAnswers';

const fields: PublicFormField[] = [
  { id: 'title', type: 'shortText', label: 'Summary', required: true, role: 'title' },
  { id: 'details', type: 'longText', label: 'Details', required: false, role: 'quote' },
  {
    id: 'kind',
    type: 'select',
    label: 'Type',
    required: true,
    options: [
      { id: 'bug', label: 'Bug' },
      { id: 'idea', label: 'Idea' },
    ],
  },
  {
    id: 'where',
    type: 'multiSelect',
    label: 'Where',
    required: true,
    options: [
      { id: 'web', label: 'Web' },
      { id: 'mobile', label: 'Mobile' },
    ],
  },
  { id: 'ok', type: 'checkbox', label: 'I checked the docs', required: true },
];

describe('emptyAnswers', () => {
  it('one empty answer per field, by type', () => {
    assert.deepEqual(emptyAnswers(fields), {
      title: '',
      details: '',
      kind: '',
      where: [],
      ok: false,
    });
  });

  it('no fields → empty object', () => {
    assert.deepEqual(emptyAnswers([]), {});
  });
});

describe('answerErrors', () => {
  it('every required field unanswered is reported; optional ones are not', () => {
    assert.deepEqual(answerErrors(fields, emptyAnswers(fields)), {
      title: 'Required',
      kind: 'Required',
      where: 'Required',
      ok: 'Required',
    });
  });

  it('whitespace-only text counts as unanswered', () => {
    const answers = { ...emptyAnswers(fields), title: '   ' };
    assert.equal(answerErrors(fields, answers).title, 'Required');
  });

  it('a fully answered form has no errors', () => {
    assert.deepEqual(
      answerErrors(fields, {
        title: 'Crash on save',
        details: '',
        kind: 'bug',
        where: ['web'],
        ok: true,
      }),
      {},
    );
  });

  it('text over 10,000 characters is refused, 10,000 is accepted', () => {
    const base = { title: 'x', details: '', kind: 'bug', where: ['web'], ok: true };
    assert.equal(MAX_ANSWER_LENGTH, 10_000);
    assert.deepEqual(answerErrors(fields, { ...base, details: 'a'.repeat(10_000) }), {});
    assert.deepEqual(answerErrors(fields, { ...base, details: 'a'.repeat(10_001) }), {
      details: 'At most 10,000 characters',
    });
  });
});

describe('titleAnswer', () => {
  it('the trimmed answer of the title question', () => {
    assert.equal(titleAnswer(fields, { title: '  Dark mode  ' }), 'Dark mode');
  });

  it('empty when the form has no title question or it is unanswered', () => {
    assert.equal(titleAnswer(fields.slice(1), { title: 'x' }), '');
    assert.equal(titleAnswer(fields, {}), '');
  });
});
