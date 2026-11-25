import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gqlData, signUpAs } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { instance, ok } from '../../../portal/__tests__/helpers';

// The Customers switch and currency (/api/auth/instance/customers-settings*), and
// Linear's customer statuses and tiers in GraphQL. Off by default; the first time
// an owner or admin turns it on the statuses Active, Prospect and Churned are made.

const save = (as: TestUser, body: Record<string, unknown>) =>
  instance('customers-settings/save', as, body);

const turnOn = async (as: TestUser) => ok(await save(as, { enabled: true }));

const statusNames = async (as: TestUser) =>
  (
    await gqlData(as, `{ customerStatuses { nodes { name displayName position } } }`)
  ).customerStatuses.nodes.map((s: { name: string }) => s.name);

async function errorCode(as: TestUser, query: string, variables?: Record<string, unknown>) {
  const res = await gql({ cookie: as.cookie }, query, variables);
  return res.body.errors?.[0]?.extensions?.code;
}

const CREATE_STATUS = `mutation($input: CustomerStatusCreateInput!) {
  customerStatusCreate(input: $input) { success status { id name displayName color position } }
}`;
const CREATE_TIER = `mutation($input: CustomerTierCreateInput!) {
  customerTierCreate(input: $input) { success tier { id name displayName color position } }
}`;

describe('customers settings', () => {
  beforeEach(resetDb);

  it('customers are off by default', async () => {
    const owner = await signUpTestUser();
    const data = await gqlData(
      owner,
      `{ organization { customersEnabled customersConfiguration } }`,
    );
    expect(data.organization.customersEnabled).toBe(false);
    expect(data.organization.customersConfiguration).toEqual({ revenueCurrency: 'USD' });
    expect(await statusNames(owner)).toEqual([]);
    const settings = await ok(await instance('customers-settings', owner));
    expect(settings).toEqual({ enabled: false, revenueCurrency: 'USD' });
  });

  it('an admin turns customers on and gets the default statuses once', async () => {
    await signUpTestUser();
    const admin = await signUpAs('admin');
    expect(await turnOn(admin)).toEqual({ enabled: true, revenueCurrency: 'USD' });
    expect(await statusNames(admin)).toEqual(['Active', 'Prospect', 'Churned']);
    await ok(await save(admin, { enabled: false }));
    await turnOn(admin);
    expect(await statusNames(admin)).toEqual(['Active', 'Prospect', 'Churned']);
    const tiers = await gqlData(admin, `{ customerTiers { nodes { id } } }`);
    expect(tiers.customerTiers.nodes).toEqual([]);
    const org = await gqlData(admin, `{ organization { customersEnabled } }`);
    expect(org.organization.customersEnabled).toBe(true);
  });

  it('a member reads the settings but cannot change them', async () => {
    await signUpTestUser();
    const member = await signUpAs('member');
    expect((await instance('customers-settings', member)).status).toBe(200);
    expect((await save(member, { enabled: true })).status).toBe(403);
  });

  it('a guest reads customersEnabled but no statuses or settings', async () => {
    const owner = await signUpTestUser();
    await turnOn(owner);
    const guest = await signUpAs('guest');
    const data = await gqlData(guest, `{ organization { customersEnabled } }`);
    expect(data.organization.customersEnabled).toBe(true);
    expect(await statusNames(guest)).toEqual([]);
    expect((await instance('customers-settings', guest)).status).toBe(403);
  });

  it('the currency must be three uppercase letters', async () => {
    const owner = await signUpTestUser();
    expect((await save(owner, { revenueCurrency: 'usd' })).status).toBe(400);
    expect((await save(owner, { revenueCurrency: 'EURO' })).status).toBe(400);
    expect((await save(owner, { enabled: 'yes' })).status).toBe(400);
    await ok(await save(owner, { revenueCurrency: 'EUR' }));
    const data = await gqlData(owner, `{ organization { customersConfiguration } }`);
    expect(data.organization.customersConfiguration).toEqual({ revenueCurrency: 'EUR' });
  });

  it('status and tier mutations need Customers on and an admin', async () => {
    const owner = await signUpTestUser();
    const member = await signUpAs('member');
    const input = { input: { name: 'Paused', color: '#aaaaaa' } };
    expect(await errorCode(owner, CREATE_STATUS, input)).toBe('INVALID_INPUT');
    const off = await gql({ cookie: owner.cookie }, CREATE_STATUS, input);
    expect(off.body.errors?.[0]?.message).toBe('Customers are not enabled');
    await turnOn(owner);
    expect(await errorCode(member, CREATE_STATUS, input)).toBe('FORBIDDEN');
    expect(await errorCode(member, CREATE_TIER, input)).toBe('FORBIDDEN');
    const made = await gqlData(owner, CREATE_STATUS, input);
    expect(made.customerStatusCreate.status.name).toBe('Paused');
    expect(made.customerStatusCreate.status.displayName).toBe('Paused');
    expect(await statusNames(member)).toEqual(['Active', 'Prospect', 'Churned', 'Paused']);
  });

  it('a status is created, renamed, reordered and read by id', async () => {
    const owner = await signUpTestUser();
    await turnOn(owner);
    const made = await gqlData(owner, CREATE_STATUS, {
      input: { name: 'Trial', displayName: 'On trial', color: '#ff0000', position: -1 },
    });
    const id = made.customerStatusCreate.status.id;
    expect(await statusNames(owner)).toEqual(['Trial', 'Active', 'Prospect', 'Churned']);
    const updated = await gqlData(
      owner,
      `mutation($id: String!) { customerStatusUpdate(id: $id, input: { name: "Pilot", description: "Testing", position: 100000 }) { status { name displayName description } } }`,
      { id },
    );
    expect(updated.customerStatusUpdate.status).toEqual({
      name: 'Pilot',
      displayName: 'On trial',
      description: 'Testing',
    });
    expect(await statusNames(owner)).toEqual(['Active', 'Prospect', 'Churned', 'Pilot']);
    const read = await gqlData(owner, `query($id: String!) { customerStatus(id: $id) { name } }`, {
      id,
    });
    expect(read.customerStatus.name).toBe('Pilot');
  });

  it('a status needs a name and a colour', async () => {
    const owner = await signUpTestUser();
    await turnOn(owner);
    expect(await errorCode(owner, CREATE_STATUS, { input: { name: ' ', color: '#000' } })).toBe(
      'INVALID_INPUT',
    );
    expect(await errorCode(owner, CREATE_STATUS, { input: { color: '#000' } })).toBe(
      'INVALID_INPUT',
    );
    expect(await errorCode(owner, CREATE_STATUS, { input: { name: 'X', color: 'red' } })).toBe(
      'INVALID_INPUT',
    );
  });

  it('the last status cannot be deleted', async () => {
    const owner = await signUpTestUser();
    await turnOn(owner);
    const ids = (
      await gqlData(owner, `{ customerStatuses { nodes { id } } }`)
    ).customerStatuses.nodes.map((s: { id: string }) => s.id);
    const del = `mutation($id: String!) { customerStatusDelete(id: $id) { success entityId } }`;
    for (const id of ids.slice(1)) {
      const res = await gqlData(owner, del, { id });
      expect(res.customerStatusDelete).toEqual({ success: true, entityId: id });
    }
    expect(await errorCode(owner, del, { id: ids[0] })).toBe('INVALID_INPUT');
    expect(await statusNames(owner)).toEqual(['Active']);
  });

  it('a tier is created, updated and deleted', async () => {
    const owner = await signUpTestUser();
    await turnOn(owner);
    const made = await gqlData(owner, CREATE_TIER, {
      input: { name: 'Enterprise', color: '#5e6ad2' },
    });
    const id = made.customerTierCreate.tier.id;
    const updated = await gqlData(
      owner,
      `mutation($id: String!) { customerTierUpdate(id: $id, input: { color: "#000000" }) { tier { color name } } }`,
      { id },
    );
    expect(updated.customerTierUpdate.tier).toEqual({ color: '#000000', name: 'Enterprise' });
    await gqlData(owner, `mutation($id: String!) { customerTierDelete(id: $id) { success } }`, {
      id,
    });
    expect(
      await errorCode(owner, `query($id: String!) { customerTier(id: $id) { id } }`, { id }),
    ).toBe('ENTITY_NOT_FOUND');
  });

  it('with Customers off, statuses and tiers read as empty', async () => {
    const owner = await signUpTestUser();
    await turnOn(owner);
    await ok(await save(owner, { enabled: false }));
    expect(await statusNames(owner)).toEqual([]);
  });
});
