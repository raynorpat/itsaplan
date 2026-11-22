import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';

// Instance secrets (Google and storage settings) are the owner's; admins keep the
// rest of god mode.

describe('god-mode settings', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lets only owners change instance-secret settings', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const asOwner = authedApi(owner.cookie);
    const admin = await signUpWithRole('admin');
    expect((await admin.api.god['google-settings'].put({ enabled: false } as never)).status).toBe(
      403,
    );
    expect((await admin.api.god['storage-settings'].put({} as never)).status).toBe(403);
    expect((await admin.api.god['google-settings'].get()).status).toBe(200);
    expect((await asOwner.god['google-settings'].put({ enabled: false } as never)).status).toBe(
      200,
    );
  });
});
