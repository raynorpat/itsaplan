import { Elysia, t } from 'elysia';
import { authContext } from '../shared/auth-context';
import { ErrorResponse } from '../shared/responses';
import { getStorageSettings, StorageSettingsSchema } from './storage';
import { getAppVersion } from './version';

// Routes for global instance settings (app_setting): a key-value store not scoped
// to a team. The MCP toggle is per-team (see teams/routes.ts), not here.
//
// Storage limits are readable by any signed-in user, because the upload UI shows
// them before a file is picked. The sizes come from the environment and the accepted
// types from the workspace settings (../organization).
export const settingsRoutes = new Elysia({
  name: 'settings',
  detail: { tags: ['Settings'] },
})
  .use(authContext)
  .get('/settings/storage', () => getStorageSettings(), {
    response: { 200: StorageSettingsSchema, 401: ErrorResponse },
    detail: {
      summary: 'Get storage limits',
      description: 'Get the instance upload limits the UI shows before a file is picked.',
    },
  })

  // The running version, shown in the sidebar and in workspace settings. A session is
  // required: the version tells an anonymous visitor which release to look up
  // vulnerabilities for.
  .get('/settings/version', () => ({ version: getAppVersion() }), {
    response: { 200: t.Object({ version: t.String() }), 401: ErrorResponse },
    detail: {
      summary: 'Get the running version',
      description: 'Get the version of the app this instance runs.',
    },
  });
