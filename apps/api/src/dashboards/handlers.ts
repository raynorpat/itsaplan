import { getActiveSession, type DashboardsHandlers } from '@repo/auth';
import { HttpError } from '../shared/lib';
import {
  createDashboard,
  deleteDashboard,
  duplicateDashboard,
  feedbackDashboard,
  getDashboard,
  listDashboards,
  updateDashboard,
} from './store';

// The instance plugin's dashboard endpoints (/api/auth/instance/dashboards*); the
// store checks who may see and change each dashboard.

async function signedIn(headers: Headers) {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return session.user;
}

export const dashboardsHandlers: DashboardsHandlers = {
  list: async (headers) => ({ dashboards: await listDashboards(await signedIn(headers)) }),
  get: async (headers, query) => ({
    dashboard: await getDashboard(await signedIn(headers), query.id),
  }),
  create: async (headers, body) => ({
    dashboard: await createDashboard(await signedIn(headers), body),
  }),
  update: async (headers, body) => ({
    dashboard: await updateDashboard(await signedIn(headers), body),
  }),
  remove: async (headers, body) => {
    await deleteDashboard(await signedIn(headers), body);
    return { success: true };
  },
  duplicate: async (headers, body) => ({
    dashboard: await duplicateDashboard(await signedIn(headers), body),
  }),
  feedback: async (headers, body) => ({
    dashboard: await feedbackDashboard(await signedIn(headers), body),
  }),
};
