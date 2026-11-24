import { getActiveSession, type WorkflowsHandlers } from '@repo/auth';
import { HttpError } from '../shared/lib';
import {
  archiveWorkflow,
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  reorderWorkflow,
  setWorkflowEnabled,
  updateWorkflow,
} from './store';
import type { RuleInput } from './validate';

// The instance plugin's workflow endpoints (packages/auth src/instance-plugin.ts):
// a signed-in user (session cookie or API key) managing a team's automation rules.
// Every answer carries the rule as `workflow`, or the list as `workflows`.

async function userId(headers: Headers): Promise<string> {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return session.user.id;
}

const fields = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

export const workflowsHandlers: WorkflowsHandlers = {
  list: async (headers, query) => ({
    workflows: await listWorkflows(
      query.teamId,
      await userId(headers),
      query.includeArchived === 'true' || query.includeArchived === true,
    ),
  }),
  get: async (headers, query) => ({ workflow: await getWorkflow(query.id, await userId(headers)) }),
  create: async (headers, body) => ({
    workflow: await createWorkflow(fields(body) as RuleInput, await userId(headers)),
  }),
  update: async (headers, body) => {
    const { id, ...patch } = fields(body);
    return { workflow: await updateWorkflow(id, patch as RuleInput, await userId(headers)) };
  },
  enable: async (headers, body) => {
    const { id, enabled } = fields(body);
    return { workflow: await setWorkflowEnabled(id, enabled, await userId(headers)) };
  },
  reorder: async (headers, body) => {
    const { id, sortOrder } = fields(body);
    return { workflow: await reorderWorkflow(id, sortOrder, await userId(headers)) };
  },
  archive: async (headers, body) => ({
    workflow: await archiveWorkflow(fields(body).id, true, await userId(headers)),
  }),
  unarchive: async (headers, body) => ({
    workflow: await archiveWorkflow(fields(body).id, false, await userId(headers)),
  }),
  delete: async (headers, body) => {
    await deleteWorkflow(fields(body).id, await userId(headers));
    return { success: true };
  },
};
