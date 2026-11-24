import { db, issue, issueLabel, workflowDefinition } from '@repo/db';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { createComment } from '../comments/store';
import { issueFilterSql } from '../graphql/issue-filter';
import {
  setIssueRuleHook,
  updateIssue,
  validateIssuePatch,
  type IssuePatch,
} from '../issues/store';
import { ruleCache, runAsWorkflow } from '../shared/workflow-context';
import { mapWorkflow, RULE_ORDER, type WorkflowRow } from './store';
import type { WorkflowAction } from './validate';

// Runs a team's automation rules after a person's issue change (registered with the
// issues store through setIssueRuleHook). A created rule runs when a new issue
// matches its conditions; an updated rule when an edit makes an issue match that did
// not before. Each matching rule, in order (RULE_ORDER), applies its changes as one
// issue update attributed to the rule, then adds its comments; a later rule runs only
// if the issue still matches it after the earlier rules' changes. A rule's own
// changes run no rules (runAsWorkflow). An action that no longer fits is skipped and
// recorded in the rule's stats; nothing here fails the person's change.

// Stands in for a rule without an owner where a condition reads "me".
const NO_USER = '00000000-0000-0000-0000-000000000000';

async function loadRules(teamId: string): Promise<WorkflowRow[]> {
  const cache = ruleCache();
  const cached = cache?.get(teamId) as WorkflowRow[] | undefined;
  if (cached) return cached;
  const rows = await db
    .select()
    .from(workflowDefinition)
    .where(
      and(
        eq(workflowDefinition.teamId, teamId),
        eq(workflowDefinition.enabled, true),
        isNull(workflowDefinition.archivedAt),
      ),
    )
    .orderBy(...RULE_ORDER);
  const rules = rows.map(mapWorkflow);
  cache?.set(teamId, rules);
  return rules;
}

// The ids of the rules whose conditions the issue matches now, in one query. A rule
// whose conditions can no longer be built matches nothing.
async function matching(issueId: string, rules: WorkflowRow[]): Promise<Set<string>> {
  if (rules.length === 0) return new Set();
  const columns: Record<string, SQL<boolean>> = {};
  rules.forEach((rule, i) => {
    let condition: SQL | undefined;
    try {
      condition = issueFilterSql(rule.conditions, rule.ownerId ?? NO_USER);
    } catch {
      columns[`r${i}`] = sql<boolean>`false`;
      return;
    }
    columns[`r${i}`] = condition ? sql<boolean>`coalesce((${condition}), false)` : sql`true`;
  });
  const [row] = await db.select(columns).from(issue).where(eq(issue.id, issueId));
  const out = new Set<string>();
  if (!row) return out;
  rules.forEach((rule, i) => {
    if ((row as Record<string, unknown>)[`r${i}`] === true) out.add(rule.id);
  });
  return out;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// The field part of a rule's actions as an issue patch, keeping only the fields that
// still pass the issue's checks.
async function fieldPatch(
  issueId: string,
  actions: WorkflowAction[],
  errors: string[],
): Promise<IssuePatch> {
  const patch: IssuePatch = {};
  for (const action of actions) {
    let field: IssuePatch | null = null;
    if (action.type === 'setState') field = { stateId: action.stateId };
    if (action.type === 'setAssignee') field = { assigneeUserId: action.userId };
    if (action.type === 'setPriority') field = { priority: action.priority };
    if (action.type === 'setProject') field = { projectId: action.projectId };
    if (action.type === 'setCycle') field = { cycleId: action.cycleId };
    if (action.type === 'setDelegate') field = { delegateUserId: action.appUserId };
    if (!field) continue;
    try {
      await validateIssuePatch(issueId, field);
      Object.assign(patch, field);
    } catch (err) {
      errors.push(`${action.type}: ${message(err)}`);
    }
  }
  return patch;
}

// The issue's labels after the rule's label actions, or undefined when they change
// nothing or no longer pass the label checks.
async function labelSet(
  issueId: string,
  actions: WorkflowAction[],
  errors: string[],
): Promise<string[] | undefined> {
  const labelActions = actions.filter((a) => a.type === 'addLabels' || a.type === 'removeLabels');
  if (labelActions.length === 0) return undefined;
  const current = (
    await db
      .select({ labelId: issueLabel.labelId })
      .from(issueLabel)
      .where(eq(issueLabel.issueId, issueId))
  ).map((r) => r.labelId);
  const next = new Set(current);
  for (const action of labelActions) {
    if (action.type === 'addLabels') for (const id of action.labelIds) next.add(id);
    if (action.type === 'removeLabels') for (const id of action.labelIds) next.delete(id);
  }
  const labelIds = [...next];
  if (labelIds.length === current.length && labelIds.every((id) => current.includes(id)))
    return undefined;
  try {
    await validateIssuePatch(issueId, {}, labelIds);
    return labelIds;
  } catch (err) {
    errors.push(`labels: ${message(err)}`);
    return undefined;
  }
}

// Counts the run and records its error, or clears the last one after a clean run, in
// one statement so concurrent runs of the same rule all count. `stats.lastError` is
// the error of the most recent run, if it had one.
async function recordRun(ruleId: string, errors: string[]): Promise<void> {
  const error = errors.length ? { lastError: errors.join('; ') } : {};
  await db
    .update(workflowDefinition)
    .set({
      stats: sql`((coalesce(${workflowDefinition.stats}, '{}'::jsonb) - 'lastError') || ${JSON.stringify(error)}::jsonb)
        || jsonb_build_object('runs', coalesce((${workflowDefinition.stats} ->> 'runs')::int, 0) + 1)`,
      lastExecutedAt: sql`now()`,
    })
    .where(eq(workflowDefinition.id, ruleId));
}

// Runs one rule on the issue. Never throws: an error is logged and recorded.
async function runRule(rule: WorkflowRow, issueId: string): Promise<void> {
  const errors: string[] = [];
  try {
    await runAsWorkflow({ id: rule.id, name: rule.name, ownerId: rule.ownerId }, async () => {
      const patch = await fieldPatch(issueId, rule.activities, errors);
      const labelIds = await labelSet(issueId, rule.activities, errors);
      if (Object.keys(patch).length > 0 || labelIds)
        await updateIssue(issueId, patch, null, labelIds ? { labelIds } : {});
      for (const action of rule.activities) {
        if (action.type !== 'addComment') continue;
        try {
          await createComment({ parent: { issueId }, body: action.body, actorUserId: null });
        } catch (err) {
          errors.push(`addComment: ${message(err)}`);
        }
      }
    });
  } catch (err) {
    errors.push(message(err));
  }
  if (errors.length) console.error(`[workflows] rule ${rule.id} on ${issueId}:`, errors.join('; '));
  try {
    await recordRun(rule.id, errors);
  } catch (err) {
    console.error(`[workflows] recording rule ${rule.id} failed:`, err);
  }
}

// Runs the rules that matched, in order. After a rule has run, each later rule is
// checked against the issue again before it runs, so a rule whose conditions an
// earlier rule's change broke does not run. Returns whether any rule ran.
async function runRules(issueId: string, rules: WorkflowRow[]): Promise<boolean> {
  let ran = false;
  for (const rule of rules) {
    if (ran && !(await matching(issueId, [rule])).has(rule.id)) continue;
    await runRule(rule, issueId);
    ran = true;
  }
  return ran;
}

interface UpdateState {
  rules: WorkflowRow[];
  matchedBefore: Set<string>;
}

setIssueRuleHook({
  async before(issueId, teamId): Promise<UpdateState | null> {
    const rules = (await loadRules(teamId)).filter((r) => r.trigger === 'entityUpdated');
    if (rules.length === 0) return null;
    return { rules, matchedBefore: await matching(issueId, rules) };
  },
  async afterUpdate(state, issueId) {
    const { rules, matchedBefore } = state as UpdateState;
    const after = await matching(issueId, rules);
    return runRules(
      issueId,
      rules.filter((r) => after.has(r.id) && !matchedBefore.has(r.id)),
    );
  },
  async afterCreate(issueId, teamId) {
    const rules = (await loadRules(teamId)).filter((r) => r.trigger === 'entityCreated');
    if (rules.length === 0) return false;
    const matched = await matching(issueId, rules);
    return runRules(
      issueId,
      rules.filter((r) => matched.has(r.id)),
    );
  },
});
