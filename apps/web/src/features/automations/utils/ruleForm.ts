import { priorityLabel } from '@/utils/fieldOptions';
import { cycleLabel } from '@/utils/cycles';
import { EMPTY_FILTER_SET, type FilterSet } from '@/utils/filters';
import { filterSetToIssueFilter, issueFilterToFilterSet } from '@/utils/viewFilters';
import type { EditAccess, WorkflowAction, WorkflowRule, WorkflowTrigger } from './rules';

// The automation editor's state. `filters` is what the filter bar shows; the rule's
// stored conditions stay in `rawConditions` and are sent back unchanged until the
// filters are edited, so a condition the filter bar cannot show (one set through the
// API or MCP) is not lost by saving the name.
export interface RuleForm {
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  filters: FilterSet;
  filtersEdited: boolean;
  rawConditions: Record<string, unknown>;
  actions: WorkflowAction[];
  editAccess: EditAccess;
}

export function ruleToForm(rule: WorkflowRule | null): RuleForm {
  if (!rule)
    return {
      name: '',
      description: '',
      trigger: 'entityCreated',
      filters: EMPTY_FILTER_SET,
      filtersEdited: false,
      rawConditions: {},
      actions: [],
      editAccess: 'teamOwners',
    };
  return {
    name: rule.name,
    description: rule.description ?? '',
    trigger: rule.trigger,
    filters: issueFilterToFilterSet(rule.conditions),
    filtersEdited: false,
    rawConditions: rule.conditions,
    actions: rule.activities,
    editAccess: rule.editAccess,
  };
}

// JSON with object keys sorted, to compare two filters regardless of key order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

// True when the filter bar cannot show all of `conditions` (reading them back and
// writing them again does not give the same filter).
export function conditionsHidden(conditions: Record<string, unknown>): boolean {
  const shown = filterSetToIssueFilter(issueFilterToFilterSet(conditions));
  return canonical(shown) !== canonical(conditions);
}

export type ActionType = WorkflowAction['type'];

// The actions the editor offers, in its "Add action" menu order.
export const ACTION_TYPES: { type: ActionType; label: string }[] = [
  { type: 'setState', label: 'Set status' },
  { type: 'setAssignee', label: 'Set assignee' },
  { type: 'setPriority', label: 'Set priority' },
  { type: 'addLabels', label: 'Add labels' },
  { type: 'removeLabels', label: 'Remove labels' },
  { type: 'setProject', label: 'Set project' },
  { type: 'setCycle', label: 'Set cycle' },
  { type: 'setDelegate', label: 'Delegate to an agent' },
  { type: 'addComment', label: 'Add a comment' },
];

// A new action of `type` with an empty value; a status action starts on the team's
// first state.
export function newAction(type: ActionType, states: { id: string }[]): WorkflowAction {
  switch (type) {
    case 'setState':
      return { type, stateId: states[0]?.id ?? '' };
    case 'setAssignee':
      return { type, userId: null };
    case 'setPriority':
      return { type, priority: 1 };
    case 'addLabels':
    case 'removeLabels':
      return { type, labelIds: [] };
    case 'setProject':
      return { type, projectId: null };
    case 'setCycle':
      return { type, cycleId: null };
    case 'setDelegate':
      return { type, appUserId: null };
    case 'addComment':
      return { type, body: '' };
  }
}

// The first problem in an action list that the API would refuse, as a sentence.
function actionError(actions: WorkflowAction[]): string | null {
  if (actions.length === 0) return 'Add at least one action.';
  for (const a of actions) {
    if (a.type === 'setState' && !a.stateId) return 'Choose a status for each status action.';
    if ((a.type === 'addLabels' || a.type === 'removeLabels') && a.labelIds.length === 0)
      return 'Choose at least one label for each label action.';
    if (a.type === 'addComment' && !a.body.trim()) return 'A comment action needs text.';
  }
  return null;
}

// The create / update body for the instance plugin (apps/api/src/workflows/validate.ts),
// or the first error the API would also return, so it is shown before any request.
export function formToRuleInput(
  form: RuleForm,
  teamId: string,
): { input: Record<string, unknown> } | { error: string } {
  const name = form.name.trim();
  if (!name) return { error: 'Give the automation a name.' };
  const conditions = form.filtersEdited ? filterSetToIssueFilter(form.filters) : form.rawConditions;
  if (form.trigger === 'entityUpdated' && Object.keys(conditions).length === 0)
    return { error: 'An automation that runs when an issue starts matching needs conditions.' };
  const error = actionError(form.actions);
  if (error) return { error };
  return {
    input: {
      teamId,
      name,
      description: form.description.trim() || null,
      trigger: form.trigger,
      activationMode: form.trigger === 'entityUpdated' ? 'conditionsStartedMatching' : null,
      conditions,
      activities: form.actions.map((a) =>
        a.type === 'addComment' ? { ...a, body: a.body.trim() } : a,
      ),
      editAccess: form.editAccess,
    },
  };
}

// The update body for an existing rule: `input` without the team (a rule cannot move)
// and without conditions or actions that did not change. The API makes whoever sends
// conditions or actions the rule's owner, so a rename keeps the owner.
export function ruleUpdatePatch(
  input: Record<string, unknown>,
  rule: Pick<WorkflowRule, 'conditions' | 'activities'>,
): Record<string, unknown> {
  const { teamId: _teamId, ...patch } = input;
  if (canonical(patch.conditions) === canonical(rule.conditions)) delete patch.conditions;
  if (canonical(patch.activities) === canonical(rule.activities)) delete patch.activities;
  return patch;
}

// The names an action summary looks ids up in.
export interface SummaryContext {
  states: { id: string; name: string }[];
  labels: { id: string; name: string }[];
  users: { userId: string; name: string }[];
  projects: { id: string; name: string }[];
  cycles: { id: string; name: string | null; number: number }[];
  // Ids whose lookup has not answered yet (a project or cycle loaded by its own
  // query); they are not reported missing.
  pendingIds?: string[];
}

// One action as a sentence ("Set status to Done"). An id that is not in `ctx` (a
// removed state, label, member, project or cycle) reads "a removed …" and marks the
// action as missing, so the editor can point at it.
export function actionSummary(
  action: WorkflowAction,
  ctx: SummaryContext,
): { text: string; missing: boolean } {
  let missing = false;
  const pendingIds = ctx.pendingIds ?? [];
  const name = <T>(
    list: T[],
    id: string,
    match: (item: T) => boolean,
    label: (item: T) => string,
    what: string,
  ) => {
    const found = list.find(match);
    if (found) return label(found);
    if (pendingIds.includes(id)) return '…';
    missing = true;
    return `a removed ${what}`;
  };
  const labelNames = (ids: string[]) =>
    ids
      .map((id) =>
        name(
          ctx.labels,
          id,
          (l) => l.id === id,
          (l) => l.name,
          'label',
        ),
      )
      .join(', ');

  let text: string;
  switch (action.type) {
    case 'setState':
      text = `Set status to ${name(
        ctx.states,
        action.stateId,
        (s) => s.id === action.stateId,
        (s) => s.name,
        'status',
      )}`;
      break;
    case 'setAssignee':
      text = action.userId
        ? `Assign to ${name(
            ctx.users,
            action.userId,
            (u) => u.userId === action.userId,
            (u) => u.name,
            'member',
          )}`
        : 'Remove the assignee';
      break;
    case 'setDelegate':
      text = action.appUserId
        ? `Delegate to ${name(
            ctx.users,
            action.appUserId,
            (u) => u.userId === action.appUserId,
            (u) => u.name,
            'agent',
          )}`
        : 'Remove the delegate';
      break;
    case 'setPriority':
      text = `Set priority to ${priorityLabel(action.priority)}`;
      break;
    case 'addLabels':
      text = `Add labels ${labelNames(action.labelIds)}`;
      break;
    case 'removeLabels':
      text = `Remove labels ${labelNames(action.labelIds)}`;
      break;
    case 'setProject':
      text = action.projectId
        ? `Set project to ${name(
            ctx.projects,
            action.projectId,
            (p) => p.id === action.projectId,
            (p) => p.name,
            'project',
          )}`
        : 'Remove the project';
      break;
    case 'setCycle':
      text = action.cycleId
        ? `Set cycle to ${name(
            ctx.cycles,
            action.cycleId,
            (c) => c.id === action.cycleId,
            cycleLabel,
            'cycle',
          )}`
        : 'Remove the cycle';
      break;
    case 'addComment':
      text = 'Add a comment';
      break;
  }
  return { text, missing };
}

// True when saving `patch` makes the viewer the owner of someone else's rule: the API
// makes whoever sends conditions or actions the owner.
export function takesOwnership(
  patch: Record<string, unknown>,
  rule: Pick<WorkflowRule, 'ownerId'> | null,
  viewerId: string,
): boolean {
  if (!rule || rule.ownerId === viewerId) return false;
  return 'conditions' in patch || 'activities' in patch;
}

// True when `form` differs from the form `base` gives (unsaved edits).
export function formDirty(form: RuleForm, base: WorkflowRule | null): boolean {
  return canonical(form) !== canonical(ruleToForm(base));
}
