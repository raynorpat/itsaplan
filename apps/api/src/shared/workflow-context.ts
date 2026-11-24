import { AsyncLocalStorage } from 'node:async_hooks';

// The workflow automation running the current code (workflows/engine.ts), and the
// writes that must not run automation rules. Kept in async context so the issue,
// comment, history and webhook code far below the engine can attribute a change to
// the workflow without every call passing it along.

export interface WorkflowActor {
  id: string;
  name: string;
  // The rule's owner: the creator of an agent session the rule starts by delegating.
  ownerId: string | null;
}

const running = new AsyncLocalStorage<WorkflowActor>();
const suppressed = new AsyncLocalStorage<true>();
const caches = new AsyncLocalStorage<Map<string, unknown>>();
const importing = new AsyncLocalStorage<string>();

// Runs `run` as the given workflow: its writes have no user actor and carry the
// workflow, and they run no rules.
export function runAsWorkflow<T>(workflow: WorkflowActor, run: () => T): T {
  return running.run(workflow, run);
}

export function currentWorkflow(): WorkflowActor | undefined {
  return running.getStore();
}

// Runs a system write (cycle rollover, the automatic cancel of a duplicate, the
// restore move) without automation rules.
export function withoutWorkflows<T>(run: () => T): T {
  return suppressed.run(true, run);
}

// Runs an issue import's writes (`imports/`): a system change that runs no rules and
// sends no notification and no webhook. History entries and subscribers are kept.
export function runAsImport<T>(importId: string, run: () => T): T {
  return importing.run(importId, run);
}

// The id of the import whose writes are running, if any.
export function currentImport(): string | undefined {
  return importing.getStore();
}

// Whether issue writes in this context skip the rules: a workflow's own change, a
// system write, or an import.
export function workflowsSkipped(): boolean {
  return (
    running.getStore() !== undefined ||
    suppressed.getStore() === true ||
    importing.getStore() !== undefined
  );
}

// Runs `run` with one cache of loaded rules, so a batch of issue writes loads each
// team's rules once.
export function withRuleCache<T>(run: () => T): T {
  return caches.run(new Map(), run);
}

export function ruleCache(): Map<string, unknown> | undefined {
  return caches.getStore();
}
