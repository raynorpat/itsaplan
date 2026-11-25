import { customerStatus, db, organization } from '@repo/db';
import { eq } from 'drizzle-orm';
import { getOrganization } from '../organization/store';
import {
  assertWorkspaceRole,
  NON_GUEST_ROLES,
  workspaceRole,
  type AuthUser,
} from '../shared/access';
import { HttpError } from '../shared/lib';
import { matchPeople } from './domains';

// The Customers switch (Linear's Organization.customersEnabled) and the revenue
// currency (customersConfiguration). Linear's OrganizationUpdateInput has neither, so
// owners and admins set them through /api/auth/instance/customers-settings/save. The
// first time Customers is turned on, the default statuses are created; turning it off
// keeps every customer and hides them.

export interface CustomersSettings {
  enabled: boolean;
  revenueCurrency: string;
}

// Created once, on the first enable. The first is the default for new customers.
const DEFAULT_STATUSES = [
  { name: 'Active', color: '#4cb782' },
  { name: 'Prospect', color: '#5e6ad2' },
  { name: 'Churned', color: '#95a2b3' },
];

const CURRENCY_RE = /^[A-Z]{3}$/;

export async function customersEnabled(): Promise<boolean> {
  return (await getOrganization()).customersEnabled;
}

export async function assertCustomersEnabled(): Promise<void> {
  if (!(await customersEnabled())) throw new HttpError(400, 'Customers are not enabled');
}

const settingsOf = (row: { customersEnabled: boolean; customersRevenueCurrency: string }) => ({
  enabled: row.customersEnabled,
  revenueCurrency: row.customersRevenueCurrency,
});

// Owners, admins and members read the settings; guests and app users do not.
export async function getCustomersSettings(userId: string): Promise<CustomersSettings> {
  if (!NON_GUEST_ROLES.includes(await workspaceRole(userId)))
    throw new HttpError(403, 'Guests cannot see customer settings');
  return settingsOf(await getOrganization());
}

export async function saveCustomersSettings(
  user: AuthUser,
  body: Record<string, unknown>,
): Promise<CustomersSettings> {
  await assertWorkspaceRole(user, 'admin');
  const patch: { customersEnabled?: boolean; customersRevenueCurrency?: string } = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean')
      throw new HttpError(400, 'enabled must be true or false');
    patch.customersEnabled = body.enabled;
  }
  if (body.revenueCurrency !== undefined) {
    if (typeof body.revenueCurrency !== 'string' || !CURRENCY_RE.test(body.revenueCurrency))
      throw new HttpError(400, 'revenueCurrency must be a three-letter currency code');
    patch.customersRevenueCurrency = body.revenueCurrency;
  }
  const org = await getOrganization();
  await db.transaction(async (tx) => {
    // The row lock makes two first enables seed the statuses once.
    const [locked] = await tx
      .select({ seeded: organization.customersSeeded })
      .from(organization)
      .where(eq(organization.id, org.id))
      .for('update');
    const seed = patch.customersEnabled === true && !locked!.seeded;
    await tx
      .update(organization)
      .set({ ...patch, ...(seed ? { customersSeeded: true } : {}), updatedAt: new Date() })
      .where(eq(organization.id, org.id));
    if (seed)
      await tx
        .insert(customerStatus)
        .values(DEFAULT_STATUSES.map((s, i) => ({ ...s, position: i * 1000 })));
    // Every write keeps people matched; turning Customers on checks everyone once more.
    if (patch.customersEnabled === true) await matchPeople(tx);
  });
  return settingsOf(await getOrganization());
}
