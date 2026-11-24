import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterSetToIssueFilter } from '@/utils/viewFilters';
import {
  actionSummary,
  conditionsHidden,
  formDirty,
  formToRuleInput,
  newAction,
  ruleToForm,
  ruleUpdatePatch,
  takesOwnership,
  type RuleForm,
  type SummaryContext,
} from '../ruleForm';
import type { WorkflowRule } from '../rules';

const STATE = 'aaaaaaaa-0000-4000-8000-000000000001';
const LABEL = 'aaaaaaaa-0000-4000-8000-000000000002';
const USER = 'aaaaaaaa-0000-4000-8000-000000000003';
const GONE = 'aaaaaaaa-0000-4000-8000-0000000000ff';

const ctx: SummaryContext = {
  states: [{ id: STATE, name: 'Done' }],
  labels: [{ id: LABEL, name: 'Bug' }],
  users: [{ userId: USER, name: 'Ada' }],
  projects: [],
  cycles: [],
};

function rule(over: Partial<WorkflowRule> = {}): WorkflowRule {
  return {
    id: 'r1',
    teamId: 't1',
    name: 'Urgent to Done',
    description: 'Closes urgent issues',
    trigger: 'entityCreated',
    activationMode: null,
    conditions: { and: [{ priority: { in: [1] } }] },
    activities: [{ type: 'setState', stateId: STATE }],
    enabled: true,
    sortOrder: 1,
    editAccess: 'teamOwners',
    ownerId: 'u1',
    lastExecutedAt: null,
    stats: { runs: 0 },
    archivedAt: null,
    updatedAt: '2026-11-24T09:00:00.000Z',
    ...over,
  };
}

const ok = (result: ReturnType<typeof formToRuleInput>) => {
  assert.ok('input' in result, `expected input, got ${JSON.stringify(result)}`);
  return result.input;
};

describe('ruleToForm / formToRuleInput', () => {
  it('round-trips a rule without changing its fields', () => {
    const input = ok(formToRuleInput(ruleToForm(rule()), 't1'));
    assert.deepEqual(input, {
      teamId: 't1',
      name: 'Urgent to Done',
      description: 'Closes urgent issues',
      trigger: 'entityCreated',
      activationMode: null,
      conditions: { and: [{ priority: { in: [1] } }] },
      activities: [{ type: 'setState', stateId: STATE }],
      editAccess: 'teamOwners',
    });
  });

  it('starts a new rule empty, created trigger, team owners edit access', () => {
    const form = ruleToForm(null);
    assert.equal(form.name, '');
    assert.equal(form.trigger, 'entityCreated');
    assert.deepEqual(form.filters, { conditions: [] });
    assert.deepEqual(form.actions, []);
    assert.equal(form.editAccess, 'teamOwners');
  });

  it('keeps conditions the filter bar cannot show when they were not edited', () => {
    const raw = { and: [{ estimate: { gt: 3 } }] };
    const form = ruleToForm(rule({ conditions: raw }));
    assert.deepEqual(form.filters.conditions, []);
    assert.deepEqual(ok(formToRuleInput(form, 't1')).conditions, raw);
  });

  it('converts edited filters with filterSetToIssueFilter', () => {
    const form = ruleToForm(rule());
    const filters = {
      conditions: [{ id: 'c', field: 'status', op: 'is' as const, values: [STATE] }],
    };
    const edited: RuleForm = { ...form, filters, filtersEdited: true };
    assert.deepEqual(ok(formToRuleInput(edited, 't1')).conditions, filterSetToIssueFilter(filters));
  });

  it('sets activationMode for an update rule', () => {
    const form: RuleForm = { ...ruleToForm(rule()), trigger: 'entityUpdated' };
    assert.equal(ok(formToRuleInput(form, 't1')).activationMode, 'conditionsStartedMatching');
  });

  it('trims the name and turns a blank description into null', () => {
    const form: RuleForm = { ...ruleToForm(rule()), name: '  Close  ', description: '   ' };
    const input = ok(formToRuleInput(form, 't1'));
    assert.equal(input.name, 'Close');
    assert.equal(input.description, null);
  });
});

describe('formToRuleInput errors', () => {
  const base = ruleToForm(rule());
  const error = (form: RuleForm) => {
    const result = formToRuleInput(form, 't1');
    assert.ok('error' in result, 'expected an error');
    return result.error;
  };

  it('needs a name', () => {
    assert.equal(error({ ...base, name: '  ' }), 'Give the automation a name.');
  });

  it('needs conditions for the starts-matching trigger', () => {
    const form: RuleForm = {
      ...base,
      trigger: 'entityUpdated',
      filters: { conditions: [] },
      filtersEdited: true,
    };
    assert.equal(
      error(form),
      'An automation that runs when an issue starts matching needs conditions.',
    );
  });

  it('counts a half-built condition as no condition', () => {
    const form: RuleForm = {
      ...base,
      trigger: 'entityUpdated',
      filters: { conditions: [{ id: 'c', field: 'status', op: 'is', values: [] }] },
      filtersEdited: true,
    };
    assert.match(error(form), /needs conditions/);
  });

  it('needs at least one action', () => {
    assert.equal(error({ ...base, actions: [] }), 'Add at least one action.');
  });

  it('refuses an empty comment', () => {
    assert.equal(
      error({ ...base, actions: [{ type: 'addComment', body: '  ' }] }),
      'A comment action needs text.',
    );
  });

  it('refuses an empty label list', () => {
    assert.equal(
      error({ ...base, actions: [{ type: 'addLabels', labelIds: [] }] }),
      'Choose at least one label for each label action.',
    );
  });

  it('refuses a status action without a status', () => {
    assert.equal(
      error({ ...base, actions: [{ type: 'setState', stateId: '' }] }),
      'Choose a status for each status action.',
    );
  });
});

describe('conditionsHidden', () => {
  it('is false for conditions the filter bar shows in full', () => {
    assert.equal(conditionsHidden({ and: [{ priority: { in: [1] } }] }), false);
    assert.equal(conditionsHidden({}), false);
  });

  it('is false for a filter the bar shows in another but equivalent shape', () => {
    assert.equal(conditionsHidden({ priority: { eq: 1 } }), false);
    assert.equal(conditionsHidden({ priority: { in: [1] } }), false);
    assert.equal(conditionsHidden({ and: [{ state: { id: { eq: 's1' } } }] }), false);
  });

  it('is true when part of the conditions cannot be shown', () => {
    assert.equal(conditionsHidden({ and: [{ estimate: { gt: 3 } }] }), true);
  });
});

describe('actionSummary', () => {
  it('names a known state', () => {
    assert.deepEqual(actionSummary({ type: 'setState', stateId: STATE }, ctx), {
      text: 'Set status to Done',
      missing: false,
    });
  });

  it('marks an unknown state as missing', () => {
    assert.deepEqual(actionSummary({ type: 'setState', stateId: GONE }, ctx), {
      text: 'Set status to a removed status',
      missing: true,
    });
  });

  it('reads labels, assignee, priority and comments', () => {
    assert.equal(
      actionSummary({ type: 'addLabels', labelIds: [LABEL] }, ctx).text,
      'Add labels Bug',
    );
    assert.deepEqual(actionSummary({ type: 'removeLabels', labelIds: [LABEL, GONE] }, ctx), {
      text: 'Remove labels Bug, a removed label',
      missing: true,
    });
    assert.equal(actionSummary({ type: 'setAssignee', userId: USER }, ctx).text, 'Assign to Ada');
    assert.equal(
      actionSummary({ type: 'setAssignee', userId: null }, ctx).text,
      'Remove the assignee',
    );
    assert.equal(
      actionSummary({ type: 'setPriority', priority: 1 }, ctx).text,
      'Set priority to Urgent',
    );
    assert.equal(actionSummary({ type: 'addComment', body: 'Hi' }, ctx).text, 'Add a comment');
  });
});

describe('ruleUpdatePatch', () => {
  it('leaves out unchanged conditions and actions, so a rename keeps the owner', () => {
    const stored = rule({ conditions: { and: [{ priority: { in: [1] } }] } });
    const input = ok(formToRuleInput({ ...ruleToForm(stored), name: 'Renamed' }, 't1'));
    const patch = ruleUpdatePatch(input, stored);
    assert.equal(patch.name, 'Renamed');
    assert.equal('conditions' in patch, false);
    assert.equal('activities' in patch, false);
    assert.equal('teamId' in patch, false);
  });

  it('keeps changed conditions and actions', () => {
    const stored = rule();
    const form: RuleForm = {
      ...ruleToForm(stored),
      actions: [{ type: 'setPriority', priority: 2 }],
    };
    const patch = ruleUpdatePatch(ok(formToRuleInput(form, 't1')), stored);
    assert.deepEqual(patch.activities, [{ type: 'setPriority', priority: 2 }]);
    assert.equal('conditions' in patch, false);
  });
});

describe('newAction', () => {
  it('starts a status action on the first state and others empty', () => {
    assert.deepEqual(newAction('setState', [{ id: STATE }]), { type: 'setState', stateId: STATE });
    assert.deepEqual(newAction('setState', []), { type: 'setState', stateId: '' });
    assert.deepEqual(newAction('setPriority', []), { type: 'setPriority', priority: 1 });
    assert.deepEqual(newAction('addLabels', []), { type: 'addLabels', labelIds: [] });
    assert.deepEqual(newAction('setAssignee', []), { type: 'setAssignee', userId: null });
    assert.deepEqual(newAction('addComment', []), { type: 'addComment', body: '' });
  });
});

describe('actionSummary while a lookup is pending', () => {
  const action = { type: 'setProject' as const, projectId: GONE };
  it('does not call a project missing while it is still loading', () => {
    assert.equal(actionSummary(action, { ...ctx, pendingIds: [GONE] }).missing, false);
  });
  it('calls it missing once the lookup finished without it', () => {
    assert.equal(actionSummary(action, ctx).missing, true);
  });
});

describe('takesOwnership', () => {
  it('is true when someone else owns the rule and conditions or actions are sent', () => {
    assert.equal(takesOwnership({ name: 'x', activities: [] }, rule(), 'u2'), true);
    assert.equal(takesOwnership({ name: 'x', conditions: {} }, rule(), 'u2'), true);
  });
  it('is false for a rename, for the owner, and for a new rule', () => {
    assert.equal(takesOwnership({ name: 'x' }, rule(), 'u2'), false);
    assert.equal(takesOwnership({ activities: [] }, rule(), 'u1'), false);
    assert.equal(takesOwnership({ activities: [] }, null, 'u2'), false);
  });
});

describe('formDirty', () => {
  it('is false for an untouched form and true after an edit', () => {
    const form = ruleToForm(rule());
    assert.equal(formDirty(form, rule()), false);
    assert.equal(formDirty({ ...form, name: 'Other' }, rule()), true);
    assert.equal(formDirty(ruleToForm(null), null), false);
    assert.equal(formDirty({ ...ruleToForm(null), name: 'New' }, null), true);
  });
});
