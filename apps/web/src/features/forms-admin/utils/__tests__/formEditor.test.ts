import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  eligibleBoards,
  editorFromForm,
  emptyFormEditor,
  formEditorErrors,
  formUrl,
  moveField,
  newField,
  setRole,
  templateDataFromEditor,
  type FormField,
} from '../formEditor';

const field = (id: string, type: FormField['type'], extra: Partial<FormField> = {}): FormField => ({
  id,
  type,
  label: id,
  required: false,
  ...extra,
});

describe('newField', () => {
  it('starts a text question without options, unlabelled and optional', () => {
    const f = newField('shortText');
    assert.equal(f.type, 'shortText');
    assert.equal(f.label, '');
    assert.equal(f.required, false);
    assert.equal(f.options, undefined);
    assert.ok(f.id.length > 0);
  });

  it('gives choice questions two options with their own ids', () => {
    for (const type of ['select', 'multiSelect'] as const) {
      const f = newField(type);
      assert.equal(f.options?.length, 2);
      assert.notEqual(f.options![0]!.id, f.options![1]!.id);
    }
  });

  it('gives each question a fresh id', () => {
    assert.notEqual(newField('checkbox').id, newField('checkbox').id);
  });
});

describe('moveField', () => {
  const fields = [field('a', 'shortText'), field('b', 'longText'), field('c', 'checkbox')];

  it('moves a question to a new place', () => {
    assert.deepEqual(
      moveField(fields, 0, 2).map((f) => f.id),
      ['b', 'c', 'a'],
    );
    assert.deepEqual(
      moveField(fields, 2, 0).map((f) => f.id),
      ['c', 'a', 'b'],
    );
  });

  it('leaves the list as it is for a place outside it', () => {
    assert.equal(moveField(fields, 0, 3), fields);
    assert.equal(moveField(fields, -1, 1), fields);
  });
});

describe('setRole', () => {
  const fields = [
    field('t1', 'shortText', { role: 'title' }),
    field('t2', 'shortText'),
    field('q1', 'longText'),
    field('s', 'select', { options: [{ id: 'o', label: 'O' }] }),
  ];

  it('moves the title role to another short text question', () => {
    const next = setRole(fields, 't2', 'title');
    assert.equal(next.find((f) => f.id === 't1')?.role, undefined);
    assert.equal(next.find((f) => f.id === 't2')?.role, 'title');
  });

  it('sets the quote role on a long text question', () => {
    const next = setRole(fields, 'q1', 'quote');
    assert.equal(next.find((f) => f.id === 'q1')?.role, 'quote');
    assert.equal(next.find((f) => f.id === 't1')?.role, 'title');
  });

  it('refuses a role on the wrong kind of question', () => {
    assert.equal(setRole(fields, 'q1', 'title'), fields);
    assert.equal(setRole(fields, 't2', 'quote'), fields);
    assert.equal(setRole(fields, 's', 'title'), fields);
  });

  it('clears the role with null', () => {
    const next = setRole(fields, 't1', null);
    assert.equal(next.find((f) => f.id === 't1')?.role, undefined);
  });
});

describe('formEditorErrors', () => {
  const valid = () => ({
    ...emptyFormEditor(),
    name: 'Bug report',
    teamId: 'team-1',
    slug: 'bug-report',
    fields: [field('a', 'shortText')],
  });

  it('is empty for a form that can be saved', () => {
    assert.deepEqual(formEditorErrors(valid()), {});
  });

  it('asks for a name and a team', () => {
    const errors = formEditorErrors({ ...valid(), name: '  ', teamId: '' });
    assert.ok(errors.name);
    assert.ok(errors.teamId);
  });

  it('checks the address pattern and the reserved addresses', () => {
    assert.ok(formEditorErrors({ ...valid(), slug: 'Bug Report' }).slug);
    assert.ok(formEditorErrors({ ...valid(), slug: '' }).slug);
    assert.ok(formEditorErrors({ ...valid(), slug: 'x'.repeat(49) }).slug);
    assert.ok(formEditorErrors({ ...valid(), slug: 'confirm' }).slug);
    assert.ok(formEditorErrors({ ...valid(), slug: 'confirm-info' }).slug);
    assert.equal(formEditorErrors({ ...valid(), slug: 'x'.repeat(48) }).slug, undefined);
  });

  it('flags a question without a label', () => {
    const errors = formEditorErrors({
      ...valid(),
      fields: [field('a', 'shortText', { label: ' ' })],
    });
    assert.ok(errors['field:a']);
  });

  it('flags a choice question without options or with an unlabelled option', () => {
    const none = formEditorErrors({ ...valid(), fields: [field('s', 'select', { options: [] })] });
    assert.ok(none['field:s']);
    const blank = formEditorErrors({
      ...valid(),
      fields: [field('s', 'multiSelect', { options: [{ id: 'o', label: '' }] })],
    });
    assert.ok(blank['field:s']);
  });
});

describe('eligibleBoards', () => {
  const boards = [
    { id: 'b1', teamId: 'team-1', projectId: null },
    { id: 'b2', teamId: 'team-2', projectId: null },
    { id: 'b3', teamId: null, projectId: 'p1' },
    { id: 'b4', teamId: null, projectId: 'p2' },
  ];
  const projectTeams = { p1: ['team-1', 'team-3'], p2: ['team-2'] };

  it("keeps the form team's boards and project boards whose project includes it", () => {
    assert.deepEqual(
      eligibleBoards(boards, 'team-1', projectTeams).map((b) => b.id),
      ['b1', 'b3'],
    );
  });

  it('offers no board before a team is chosen', () => {
    assert.deepEqual(eligibleBoards(boards, '', projectTeams), []);
  });

  it('leaves out a project board whose project is unknown', () => {
    assert.deepEqual(
      eligibleBoards(boards, 'team-2', {}).map((b) => b.id),
      ['b2'],
    );
  });
});

describe('editorFromForm / templateDataFromEditor', () => {
  it('reads a stored form into the editor and writes it back, keeping other template data', () => {
    const data = {
      title: 'Bug',
      description: 'Filed from the form.',
      stateId: 's1',
      labelIds: ['l1'],
      priority: 2,
      formFields: [field('a', 'shortText', { role: 'title' })],
    };
    const settings = {
      slug: 'bug',
      intro: 'Tell us',
      linkEnabled: true,
      boardIds: ['b1'],
    };
    const editor = editorFromForm(
      { name: 'Bug report', teamId: 't1', templateData: data },
      settings,
    );
    assert.equal(editor.name, 'Bug report');
    assert.equal(editor.teamId, 't1');
    assert.equal(editor.stateId, 's1');
    assert.deepEqual(editor.labelIds, ['l1']);
    assert.equal(editor.priority, 2);
    assert.equal(editor.fields.length, 1);
    assert.equal(editor.slug, 'bug');
    assert.equal(editor.linkEnabled, true);
    assert.deepEqual(editor.boardIds, ['b1']);

    const written = templateDataFromEditor({ ...editor, stateId: '', priority: 0 }, data);
    assert.equal(written.title, 'Bug');
    assert.equal(written.description, 'Filed from the form.');
    assert.equal('stateId' in written, false);
    assert.equal('priority' in written, false);
    assert.deepEqual(written.formFields, data.formFields);
  });

  it('reads missing or malformed template data as an empty form', () => {
    const editor = editorFromForm({ name: 'X', teamId: 't1', templateData: null }, null);
    assert.deepEqual(editor.fields, []);
    assert.deepEqual(editor.labelIds, []);
    assert.equal(editor.slug, '');
  });
});

describe('formUrl', () => {
  it("is the form's public address on the given origin", () => {
    assert.equal(
      formUrl('bug-report', 'https://app.example.com'),
      'https://app.example.com/forms/bug-report',
    );
  });
});
