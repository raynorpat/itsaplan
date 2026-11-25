import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyFormEditor } from '../formEditor';
import { saveFormSteps, type SaveFormApi } from '../saveForm';

// A fake API recording the calls; `failSettings` makes the settings save fail once.
function fakeApi(opts: { failValidate?: boolean; failSettings?: boolean } = {}) {
  const calls: string[] = [];
  let failSettings = opts.failSettings ?? false;
  const api: SaveFormApi = {
    validate: async (body) => {
      calls.push(`validate:${body.templateId ?? `team ${body.teamId}`}`);
      if (opts.failValidate) throw new Error('This form address is taken');
    },
    createTemplate: async () => {
      calls.push('create');
      return 't1';
    },
    updateTemplate: async (id) => {
      calls.push(`update:${id}`);
    },
    saveSettings: async (body) => {
      calls.push(`settings:${body.templateId}`);
      if (failSettings) {
        failSettings = false;
        throw new Error('settings failed');
      }
    },
  };
  return { api, calls };
}

const form = { ...emptyFormEditor(), name: 'Bug report', teamId: 'team-1', slug: 'bugs' };

describe('saveFormSteps', () => {
  it('checks the settings before it creates the template', async () => {
    const { api, calls } = fakeApi({ failValidate: true });
    await assert.rejects(
      saveFormSteps(api, { templateId: null, form, existing: {}, onCreated: () => {} }),
      /taken/,
    );
    assert.deepEqual(calls, ['validate:team team-1']);
  });

  it('updates the template it created when the retry follows a failed settings save', async () => {
    const { api, calls } = fakeApi({ failSettings: true });
    let created: string | null = null;
    const onCreated = (id: string) => {
      created = id;
    };
    await assert.rejects(
      saveFormSteps(api, { templateId: null, form, existing: {}, onCreated }),
      /settings failed/,
    );
    assert.equal(created, 't1');
    const id = await saveFormSteps(api, { templateId: created, form, existing: {}, onCreated });
    assert.equal(id, 't1');
    assert.deepEqual(calls, [
      'validate:team team-1',
      'create',
      'settings:t1',
      'validate:t1',
      'update:t1',
      'settings:t1',
    ]);
  });
});
