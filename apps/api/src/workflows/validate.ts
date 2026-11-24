import { GraphQLError } from 'graphql';
import { assertDelegate } from '../agents/store';
import { assertCycleOfTeam } from '../cycles/store';
import { issueFilterSql } from '../graphql/issue-filter';
import { assertAssignments, assertColumn, assertProject } from '../issues/store';
import { assertLabelsApplicable } from '../labels/store';
import { canSeeTeam, workspaceRole } from '../shared/access';
import { HttpError, UUID_RE } from '../shared/lib';

// The shape of a workflow rule and its validation on save: only Linear's issue
// automation (type automation, trigger type issue, triggers entityCreated and
// entityUpdated with conditionsStartedMatching), conditions in Linear's IssueFilter,
// and actions that stay inside the rule's team.

export const TRIGGERS = ['entityCreated', 'entityUpdated'] as const;
export const EDIT_ACCESS = ['everyone', 'teamOwners', 'workspaceAdmins', 'owner'] as const;
const ACTIVATION_MODE = 'conditionsStartedMatching';

export type Trigger = (typeof TRIGGERS)[number];
export type EditAccess = (typeof EDIT_ACCESS)[number];

export type WorkflowAction =
  | { type: 'setState'; stateId: string }
  | { type: 'setAssignee'; userId: string | null }
  | { type: 'setPriority'; priority: number }
  | { type: 'addLabels'; labelIds: string[] }
  | { type: 'removeLabels'; labelIds: string[] }
  | { type: 'setProject'; projectId: string | null }
  | { type: 'setCycle'; cycleId: string | null }
  | { type: 'setDelegate'; appUserId: string | null }
  | { type: 'addComment'; body: string };

export interface RuleFields {
  teamId: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  type: 'automation';
  triggerType: 'issue';
  trigger: Trigger;
  activationMode: typeof ACTIVATION_MODE | null;
  conditions: Record<string, unknown>;
  activities: WorkflowAction[];
  enabled: boolean;
  sortOrder: number;
  editAccess: EditAccess;
  ownerId: string | null;
}

// What a create or update request may carry; unknown keys are ignored.
export type RuleInput = Partial<Record<keyof RuleFields, unknown>>;

const MAX_ACTIONS = 20;
const MAX_NAME = 255;
const MAX_COMMENT = 50_000;

const bad = (message: string): never => {
  throw new HttpError(400, message);
};

function text(value: unknown, field: string, max = 10_000): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return bad(`${field} must be text`);
  if (value.length > max) return bad(`${field} is too long`);
  return value;
}

function id(value: unknown, field: string): string {
  return typeof value === 'string' && UUID_RE.test(value) ? value : bad(`${field} must be an id`);
}

const optionalId = (value: unknown, field: string): string | null =>
  value === null ? null : id(value, field);

function ids(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) return bad(`${field} must list ids`);
  return [...new Set(value.map((v) => id(v, field)))];
}

// A plain JSON copy (GraphQL-free input objects, no prototypes).
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// Conditions in Linear's IssueFilter: the filter builder refuses an unsupported field
// or comparator. `me` is the rule's owner.
function validateConditions(value: unknown, ownerId: string | null): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return bad('conditions must be an issue filter');
  const conditions = copy(value as Record<string, unknown>);
  try {
    issueFilterSql(conditions, ownerId ?? '00000000-0000-0000-0000-000000000000');
  } catch (err) {
    if (err instanceof GraphQLError) return bad(`conditions: ${err.message}`);
    throw err;
  }
  return conditions;
}

async function validateAction(raw: unknown, teamId: string): Promise<WorkflowAction> {
  if (raw === null || typeof raw !== 'object') return bad('Each action must be an object');
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case 'setState': {
      const stateId = id(a.stateId, 'setState.stateId');
      await assertColumn(teamId, stateId);
      return { type: 'setState', stateId };
    }
    case 'setAssignee': {
      const userId = optionalId(a.userId, 'setAssignee.userId');
      if (userId) await assertAssignments(teamId, { assigneeUserId: userId });
      return { type: 'setAssignee', userId };
    }
    case 'setPriority': {
      const p = a.priority;
      if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p > 4)
        return bad('setPriority.priority must be 0 to 4');
      return { type: 'setPriority', priority: p };
    }
    case 'addLabels': {
      const labelIds = ids(a.labelIds, 'addLabels.labelIds');
      await assertLabelsApplicable(teamId, labelIds);
      return { type: 'addLabels', labelIds };
    }
    case 'removeLabels': {
      const labelIds = ids(a.labelIds, 'removeLabels.labelIds');
      // Retired labels may still be on issues, so they can be removed.
      await assertLabelsApplicable(teamId, labelIds, labelIds);
      return { type: 'removeLabels', labelIds };
    }
    case 'setProject': {
      const projectId = optionalId(a.projectId, 'setProject.projectId');
      await assertProject(teamId, projectId);
      return { type: 'setProject', projectId };
    }
    case 'setCycle': {
      const cycleId = optionalId(a.cycleId, 'setCycle.cycleId');
      await assertCycleOfTeam(teamId, cycleId);
      return { type: 'setCycle', cycleId };
    }
    case 'setDelegate': {
      const appUserId = optionalId(a.appUserId, 'setDelegate.appUserId');
      if (appUserId) await assertDelegate(teamId, appUserId);
      return { type: 'setDelegate', appUserId };
    }
    case 'addComment': {
      const body = typeof a.body === 'string' ? a.body.trim() : '';
      if (!body) return bad('addComment.body must not be empty');
      if (body.length > MAX_COMMENT) return bad('addComment.body is too long');
      return { type: 'addComment', body };
    }
    default:
      return bad(`Unknown action type ${JSON.stringify(a.type)}`);
  }
}

async function validateOwner(ownerId: string | null, teamId: string): Promise<void> {
  if (!ownerId) return;
  if ((await workspaceRole(ownerId)) === 'guest' || !(await canSeeTeam(teamId, ownerId)))
    bad("The owner must be a member of the workspace who can see the rule's team");
}

// Merges `input` over `existing` (null on create) and validates the whole rule.
// `editorId` is the person saving it. A rule acts as its owner (its delegations credit
// them, `me` in its conditions is them), so the owner is only ever its last author:
// the creator, then whoever changes its conditions or actions; `ownerId` may only name
// the editor. `defaultSortOrder` places a new rule.
export async function validateRule(
  input: RuleInput,
  existing: RuleFields | null,
  editorId: string,
  defaultSortOrder: number,
): Promise<RuleFields> {
  const has = (key: keyof RuleFields) => input[key] !== undefined;
  const teamId = existing?.teamId ?? id(input.teamId, 'teamId');

  if (has('type') && input.type !== 'automation') bad('Only automation workflows are supported');
  if (has('triggerType') && input.triggerType !== 'issue')
    bad('Only issue workflows are supported');

  const trigger = (has('trigger') ? input.trigger : existing?.trigger) as Trigger;
  if (!TRIGGERS.includes(trigger)) bad('trigger must be entityCreated or entityUpdated');

  let activationMode: RuleFields['activationMode'] = null;
  if (trigger === 'entityUpdated') {
    const mode = has('activationMode') ? input.activationMode : ACTIVATION_MODE;
    if (mode !== ACTIVATION_MODE && mode !== null)
      bad('An update rule runs when the issue starts matching (conditionsStartedMatching)');
    activationMode = ACTIVATION_MODE;
  } else if (has('activationMode') && input.activationMode !== null) {
    bad('A create rule has no activation mode');
  }

  const name = has('name') ? text(input.name, 'name', MAX_NAME)?.trim() : existing?.name;
  if (!name) bad('name must not be empty');

  const editAccess = (
    has('editAccess') ? input.editAccess : (existing?.editAccess ?? 'teamOwners')
  ) as EditAccess;
  if (!EDIT_ACCESS.includes(editAccess)) bad(`editAccess must be one of ${EDIT_ACCESS.join(', ')}`);

  if (has('ownerId') && input.ownerId !== editorId)
    throw new HttpError(403, "A workflow's owner can only be set to yourself");
  const authored = !existing || has('ownerId') || has('conditions') || has('activities');
  const ownerId = authored ? editorId : existing.ownerId;
  if (ownerId !== existing?.ownerId) await validateOwner(ownerId, teamId);

  const conditions = has('conditions')
    ? validateConditions(input.conditions, ownerId)
    : (existing?.conditions ?? {});
  if (trigger === 'entityUpdated' && Object.keys(conditions).length === 0)
    bad('An update rule needs conditions');

  let activities = existing?.activities ?? [];
  if (has('activities') || !existing) {
    if (!Array.isArray(input.activities) || input.activities.length === 0)
      bad('A workflow needs at least one action');
    if ((input.activities as unknown[]).length > MAX_ACTIONS)
      bad(`A workflow has at most ${MAX_ACTIONS} actions`);
    activities = [];
    for (const raw of input.activities as unknown[])
      activities.push(await validateAction(copy(raw), teamId));
  }

  const enabled = has('enabled') ? input.enabled : (existing?.enabled ?? true);
  if (typeof enabled !== 'boolean') bad('enabled must be true or false');
  const sortOrder = has('sortOrder') ? input.sortOrder : (existing?.sortOrder ?? defaultSortOrder);
  if (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder))
    bad('sortOrder must be a number');

  return {
    teamId,
    name: name!,
    description: has('description')
      ? text(input.description, 'description')
      : (existing?.description ?? null),
    icon: has('icon') ? text(input.icon, 'icon', 100) : (existing?.icon ?? null),
    color: has('color') ? text(input.color, 'color', 100) : (existing?.color ?? null),
    type: 'automation',
    triggerType: 'issue',
    trigger,
    activationMode,
    conditions,
    activities,
    enabled: enabled as boolean,
    sortOrder: sortOrder as number,
    editAccess,
    ownerId,
  };
}
